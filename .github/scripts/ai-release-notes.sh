#!/usr/bin/env bash
# Writes release notes to ai-notes.md with Google's Gemini API (free tier), based on
# the commit messages since the previous release tag. Used by release.yml,
# prerelease.yml and release-notes.yml.
#
# Needs the GEMINI_API_KEY repository secret. If the notes can't be written (no key,
# Gemini busy or down) it fails, so the release isn't published without them - re-run
# the failed job, or skip the AI notes: set SKIP_AI_NOTES=true (the workflows set it
# from their "Skip AI release notes" option or the SKIP_AI_NOTES repository variable).
# The notes are wrapped in <!-- ai-notes --> markers, so they can be replaced later
# (release-notes.yml).
#
# Usage: ai-release-notes.sh <test|release>   (run with the release's commit checked out)

set -uo pipefail

kind="${1:-release}"
out=ai-notes.md
rm -f "$out"

# Adds lines to the run's Summary page (Actions -> the run -> Summary)
summary() {
  if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then printf '%s\n' "$@" >> "$GITHUB_STEP_SUMMARY"; fi
}

# Shows the problem as a red error in the run, and on its Summary page
fail() {
  echo "::error title=AI release notes::$1"
  summary "" "**❌ $1**"
  exit 1
}

# What an HTTP answer from Gemini means, in plain words, and what to do about it
explain() {
  local code="$1" msg="$2"
  case "$code" in
    000) echo "Couldn't reach Google (network problem on GitHub's side). Re-run the job." ;;
    400) if grep -qi 'api key' <<<"$msg"; then
           echo "The GEMINI_API_KEY secret is not a valid key. Create a new key and update the secret (Settings -> Secrets and variables -> Actions)."
         else
           echo "Google rejected the request."
         fi ;;
    401|403) echo "The key isn't allowed to use Gemini. In the key's Google Cloud project, enable \"Gemini API\", and make sure the key's API restrictions include it." ;;
    404) echo "The model \"$model\" doesn't exist (any more). Update the model names in .github/scripts/ai-release-notes.sh." ;;
    429) echo "The Gemini free limit is used up for now. Re-run the job later (limits reset every minute and every day)." ;;
    500|502|503|504) echo "Gemini is busy or down. Re-run the job later." ;;
    200) echo "Gemini answered, but without notes." ;;
    *) echo "Unexpected answer from Google (HTTP $code)." ;;
  esac
}

if [ "${SKIP_AI_NOTES:-}" = "true" ]; then
  echo "::notice::Skipping the AI release notes (SKIP_AI_NOTES)"
  exit 0
fi

summary "### AI release notes" ""

if [ -z "${GEMINI_API_KEY:-}" ]; then
  fail "No GEMINI_API_KEY secret. Add it in Settings -> Secrets and variables -> Actions, or skip the AI notes (Run workflow -> \"Skip AI release notes\", or the SKIP_AI_NOTES=true repository variable)."
fi

# A real release covers everything since the previous real release (skipping test
# tags like v2.6.0-beta.1); a test version covers the changes since the last tag
if [ "$kind" = "release" ]; then
  prev=$(git describe --tags --abbrev=0 --exclude '*-*' HEAD^ 2>/dev/null || true)
else
  # by version number, not dev's history: dev never gets master's release commits, so
  # `git describe` there skips every release (v2.8.0-beta.1 compared to v2.6.0, not v2.7.1)
  version=$(jq -r '.version_name // .version' extension/manifest.json 2>/dev/null || true)
  prev=$(bash "$(dirname "$0")/previous-tag.sh" "$version" test 2>/dev/null || true)
  if [ -z "$prev" ]; then
    prev=$(git describe --tags --abbrev=0 HEAD^ 2>/dev/null || true)
  fi
fi
echo "Notes cover the changes since ${prev:-the beginning}"

# Only changes to the extension itself matter to users (not workflows, store assets...)
range="${prev:+$prev..}HEAD"
log=$(git log --no-merges --reverse --format='- %s%n%w(0,2,2)%b' "$range" -- extension | head -c 30000)
if [ -z "$log" ]; then
  echo "::notice::No extension changes since ${prev:-the beginning} - skipping AI release notes"
  exit 0
fi

if [ "$kind" = "test" ]; then
  what="a TEST version that users install by hand to try new features before they reach the Chrome Web Store"
  extra="After the list of changes, add a short numbered \"what to test\" list based on the changes, and ask everyone to also retest the features they normally use."
else
  what="a new release that users get from the Chrome Web Store"
  extra=""
fi

prompt=$(cat <<EOF
You write release notes for "iVelt Helper" (אייוועלט העלפער), a free Chrome extension for the Yiddish forum ivelt.com. The readers are ordinary forum members, not programmers.

This is $what. Below are the commit messages since the previous release, oldest first.

Write the release notes in GitHub Markdown, in English only: a short heading, then the changes grouped under a few headings with an emoji each (for example uploads, images, colors, fixes). Describe what users can now do or what got fixed, in plain words. $extra

Rules: only mention what is in the commits - never invent features. If a change was later undone by a "Revert" commit, leave out both the change and the revert. Leave out internal things (code refactoring, workflows, build files, branding files, README, version bumps, review suggestions) unless users notice them. No commit hashes, file names or function names. Keep it short. Output only the Markdown, with no introduction and no code fences.

Commits:
$log
EOF
)

body=$(jq -n --arg p "$prompt" '{contents: [{parts: [{text: $p}]}], generationConfig: {temperature: 0.3}}')

# Gemini's free tier is sometimes "experiencing high demand": wait and retry, then
# fall back to the lighter model. A wrong key or a missing permission won't fix itself,
# so those stop right away.
models="${GEMINI_MODEL:-gemini-flash-latest gemini-flash-lite-latest}"
answer=$(mktemp)
text=""
last_problem=""
last_detail=""
summary "| Model | Try | HTTP | Result |" "|---|---|---|---|"

for model in $models; do
  for attempt in 1 2 3; do
    code=$(curl -sS --max-time 120 -o "$answer" -w '%{http_code}' \
        -H "x-goog-api-key: $GEMINI_API_KEY" \
        -H 'Content-Type: application/json' \
        -d "$body" \
        "https://generativelanguage.googleapis.com/v1beta/models/$model:generateContent" 2>"$answer.err") || code=000
    text=$(jq -r '.candidates[0].content.parts[0].text // empty' "$answer" 2>/dev/null)
    if [ "$code" = "200" ] && [ -n "$text" ]; then
      echo "Notes written by $model (try $attempt)"
      summary "| $model | $attempt | $code | ✅ notes written |"
      break 2
    fi

    # The complete answer from the API, as Google sent it (collapsible in the log)
    echo "::group::Gemini answer - $model, try $attempt (HTTP $code)"
    cat "$answer.err" "$answer" 2>/dev/null
    echo
    echo "::endgroup::"

    # Google's own words, if it sent any
    detail=$(jq -r '.error.message // .promptFeedback.blockReason // empty' "$answer" 2>/dev/null)
    [ -z "$detail" ] && detail=$(head -c 200 "$answer.err" "$answer" 2>/dev/null | tr '\n' ' ')
    last_problem=$(explain "$code" "$detail")
    last_detail="$detail"
    echo "::warning title=Gemini $model, try $attempt::HTTP $code - $last_problem ${detail:+Google said: $detail}"
    summary "| $model | $attempt | $code | ${detail:-no details} |"

    case "$code" in
      400|401|403) break 2 ;;  # wrong key / not allowed - the same for every model
      404) break ;;            # this model is gone - try the next one
    esac
    [ "$attempt" -lt 3 ] && sleep $((attempt * 30))
  done
done
rm -f "$answer" "$answer.err"

if [ -z "$text" ]; then
  fail "The release notes couldn't be written: ${last_problem:-unknown problem}${last_detail:+ (Google said: $last_detail)} Nothing was published. Fix it and re-run the failed job, or run the workflow with \"Skip AI release notes\"."
fi

# Drop a code fence in case the model wrapped its answer in one anyway
{
  echo '<!-- ai-notes -->'
  printf '%s\n' "$text" | sed -e '1{/^```/d}' -e '${/^```$/d}'
  echo '<!-- /ai-notes -->'
} > "$out"
echo "Wrote AI release notes ($(wc -c < "$out") bytes) from the changes since ${prev:-the beginning}"
summary "" "**✅ Release notes written** from the changes since ${prev:-the beginning}."
