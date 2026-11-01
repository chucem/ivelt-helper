// Undo / redo for the post editor.
//
// The forum's BBCode buttons, smilies and quote links write straight into
// textarea.value, and the browser throws away its own undo history whenever a
// page does that, so Ctrl+Z stops working after the first button click. This
// keeps our own history instead: typing is grouped by word, every button click
// is its own step, and Ctrl+Z / Ctrl+Y (also Ctrl+Shift+Z, and the right-click
// menu) plus two toolbar buttons walk through it.
//
// Runs in the page (a MAIN world content script) so it can see the forum's own
// writes to the textarea.

(function () {
    const MAX_STEPS = 300;
    const GROUP_MS = 1000; // typing faster than this stays in one step

    const UNDO_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">'
        + '<path fill="currentColor" d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62A7.95 7.95 0 0 1 12.5 10.5c3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/>'
        + '</svg>';
    const REDO_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">'
        + '<path fill="currentColor" d="M18.4 10.6C16.55 8.99 14.15 8 11.5 8c-4.65 0-8.58 3.03-9.96 7.22L3.9 16c1.05-3.19 4.05-5.5 7.6-5.5 1.95 0 3.73.72 5.12 1.88L13 16h9V7l-3.6 3.6z"/>'
        + '</svg>';

    const valueProp = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');

    function isEnabled() {
        const settings = document.getElementById('iveltHelperSettings');
        // On unless the user turned it off in the extension settings
        return !settings || settings.getAttribute('data-editor-undo') !== 'false';
    }

    // The forum uses the ABBC3 toolbar and hides phpBB's own #format-buttons
    function findToolbar(scope) {
        const isVisible = (node) => node && node.getClientRects().length > 0;
        const rows = Array.from(scope.querySelectorAll('#abbc3_buttons .abbc3_buttons_row')).filter(isVisible);
        if (rows.length) return { row: rows[0], abbc3: true };
        const stock = scope.querySelector('#format-buttons');
        return isVisible(stock) ? { row: stock, abbc3: false } : null;
    }

    function attach(textarea) {
        if (textarea.dataset.ivuAttached) return;
        textarea.dataset.ivuAttached = '1';

        const undoStack = [];
        let redoStack = [];
        let applying = false;
        let last = snapshot();
        let lastKind = '';
        let lastTime = 0;
        let undoButton = null;
        let redoButton = null;
        let replacingSelection = false;

        function snapshot() {
            return {
                value: valueProp.get.call(textarea),
                start: textarea.selectionStart,
                end: textarea.selectionEnd,
                scroll: textarea.scrollTop
            };
        }

        function pushUndo(state) {
            undoStack.push(state);
            if (undoStack.length > MAX_STEPS) undoStack.shift();
        }

        // Called after the text changed. 'typing' and 'deleting' merge into the
        // step before them while the user keeps typing (or deleting) the same word.
        function record(kind) {
            if (applying) return;
            const now = snapshot();
            if (now.value === last.value) {
                last = now;
                return;
            }
            const merge = (kind === 'typing' || kind === 'wordEnd' ? lastKind === 'typing' : kind === 'deleting' && lastKind === kind)
                && Date.now() - lastTime < GROUP_MS;
            if (!merge) pushUndo(last);
            redoStack = [];
            last = now;
            // A space or Enter stays with the word before it, and the next letter starts a new step
            lastKind = kind === 'wordEnd' ? '' : kind;
            lastTime = Date.now();
            updateButtons();
        }

        // Changes nobody told us about (e.g. the extension's own isolated
        // scripts) become their own step the next time we look
        function catchUp() {
            if (valueProp.get.call(textarea) !== last.value) record('other');
        }

        // Keep the caret position of the current state fresh, so undo puts it back
        function rememberCaret() {
            if (valueProp.get.call(textarea) === last.value) last = snapshot();
        }

        function apply(state) {
            applying = true;
            valueProp.set.call(textarea, state.value);
            textarea.focus();
            textarea.setSelectionRange(state.start, state.end);
            textarea.scrollTop = state.scroll;
            // Let anything else watching the editor (char counters, drafts) know
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
            applying = false;
            last = snapshot();
            lastKind = '';
            updateButtons();
        }

        function undo() {
            catchUp();
            if (!undoStack.length) return;
            rememberCaret();
            redoStack.push(last);
            apply(undoStack.pop());
        }

        function redo() {
            catchUp();
            if (!redoStack.length) return;
            rememberCaret();
            pushUndo(last);
            apply(redoStack.pop());
        }

        // The forum's buttons set .value (or setRangeText) directly; each one is its own step
        Object.defineProperty(textarea, 'value', {
            configurable: true,
            get() { return valueProp.get.call(this); },
            set(v) {
                catchUp();
                rememberCaret();
                valueProp.set.call(this, v);
                record('button');
                // The buttons place the caret right after setting the value
                setTimeout(rememberCaret, 0);
            }
        });
        const nativeSetRangeText = textarea.setRangeText;
        textarea.setRangeText = function () {
            catchUp();
            rememberCaret();
            const result = nativeSetRangeText.apply(this, arguments);
            record('button');
            return result;
        };

        textarea.addEventListener('beforeinput', (e) => {
            if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') {
                // The right-click menu's undo/redo; the browser's own history is broken
                e.preventDefault();
                if (e.inputType === 'historyUndo') undo(); else redo();
                return;
            }
            catchUp();
            rememberCaret();
            replacingSelection = textarea.selectionStart !== textarea.selectionEnd;
        });

        textarea.addEventListener('input', (e) => {
            if (applying) return;
            const data = e.data || '';
            // One letter at a time is typing, a space or Enter finishes the word,
            // and a paste or a whole word inserted at once (spellcheck, the image
            // resizer) is a step of its own
            let kind = 'other';
            if (replacingSelection) kind = 'other'; // typing over or deleting a selection
            else if (e.inputType === 'insertText' && data.length === 1) kind = /\s/.test(data) ? 'wordEnd' : 'typing';
            else if (e.inputType === 'insertLineBreak') kind = 'wordEnd';
            else if (e.inputType === 'deleteContentBackward' || e.inputType === 'deleteContentForward') kind = 'deleting';
            record(kind);
        });

        textarea.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            // e.code, so it also works with the Yiddish keyboard layout
            const isZ = e.code === 'KeyZ';
            const isY = e.code === 'KeyY';
            if (isZ && !e.shiftKey) {
                e.preventDefault();
                undo();
            } else if (isY || (isZ && e.shiftKey)) {
                e.preventDefault();
                redo();
            }
        });

        ['keyup', 'mouseup', 'focus', 'select'].forEach(type => textarea.addEventListener(type, rememberCaret));

        // The page restores a saved draft or the "preview" text after we loaded
        textarea.form && textarea.form.addEventListener('reset', () => setTimeout(catchUp, 0));

        addButtons();

        function addButtons() {
            const found = findToolbar(textarea.form || document);
            if (!found) return;

            const wrap = document.createElement('span');
            wrap.className = 'ivu-buttons' + (found.abbc3 ? ' ivu-in-abbc3' : '');
            undoButton = makeButton(found.abbc3, UNDO_ICON, 'צוריק (Ctrl+Z)', undo);
            redoButton = makeButton(found.abbc3, REDO_ICON, 'ווידער (Ctrl+Y)', redo);
            wrap.append(undoButton, redoButton);
            found.row.prepend(wrap);
            updateButtons();
        }

        function makeButton(abbc3, icon, label, action) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = abbc3 ? 'abbc3_button ivu-button' : 'button button-icon-only ivu-button';
            button.title = label;
            button.setAttribute('aria-label', label);
            button.innerHTML = icon;
            // Keep the caret in the textarea while clicking
            button.addEventListener('mousedown', (e) => e.preventDefault());
            button.addEventListener('click', action);
            return button;
        }

        function updateButtons() {
            if (!undoButton) return;
            undoButton.disabled = !undoStack.length;
            redoButton.disabled = !redoStack.length;
        }
    }

    function start() {
        if (!isEnabled()) return;
        document.querySelectorAll('textarea[name="message"]').forEach(attach);
    }

    whenIveltSettingsReady(start);
}());
