# Builds the what's-new video from saved screenshots: each frame stays on screen for its time,
# with a crossfade between them.
# Usage: python build.py <tool-results folder> <output.mp4>
# A desktop frame (Claude in Chrome screenshot, about 1568x773) is cropped to the forum's column and
# scaled to 1280x800. A "phone" frame (a computer-use zoom of the phone view) is scaled to the
# video's height and centered on a dark blue background. "still" (a computer-use zoom of a page
# that can't take the overlay, like the settings) and "popup" (a small window, like the toolbar
# menu) get their caption and orange frames from ffmpeg.
import glob, os, subprocess, sys, tempfile

FONT = r'C\:/Windows/Fonts/arialbd.ttf'
TMP = tempfile.mkdtemp()


def caption(i, text):
    # A caption drawn by ffmpeg, for frames that can't take the overlay. The gyan.dev ffmpeg
    # build has fribidi, so the Yiddish goes in as it is and comes out right to left
    name = f'cap{i}.txt'
    with open(os.path.join(TMP, name), 'w', encoding='utf-8') as f:
        f.write(text)
    return (f",drawtext=fontfile='{FONT}':textfile={name}:fontsize=30:fontcolor=white:"
            f"x=(w-text_w)/2:y=h-text_h-44:box=1:boxcolor=0x10203A@0.92:boxborderw=18")

T, OUT = sys.argv[1], os.path.abspath(sys.argv[2])
# (screenshot id suffix, seconds on screen, kind); 'desk:N' crops a desktop frame from x=N.
# This is 2.7.0's video. For the next one, replace the list with the new frames, in order.
frames = [
    ('llbq8y', 3.5, 'desk'),   # title
    ('1l6cgb', 4.5, 'desk'),   # select words
    ('o80569', 4.5, 'desk'),   # "ציטיר אנגעצייכנט"
    ('cos41e', 5, 'desk'),     # quote in the reply
    ('pjsxkl', 5, 'desk'),     # draft kept
    ('p4kib2', 5, 'desk'),     # restore bar
    ('7t40zb', 4, 'desk'),     # restored
    ('znvspa', 4.5, 'desk'),   # bold
    ('gonm2c', 5.5, 'desk'),   # undo / redo
    ('8dsfa5', 5, 'desk'),     # Drive / Dropbox in a new PM
    ('5h6s6s', 5.5, 'desk'),   # who liked
    ('oxvs8z', 5, 'desk'),     # @mention link (the user's own)
    ('wcpewu', 6, 'desk:236'), # profile card (the user's own), cropped further right
    ('j5zm5v', 6, 'desk'),     # double-click like
    ('kkd66z', 5, 'desk'),     # spoilers covered
    ('xx87mz', 4.5, 'desk'),   # spoilers shown
    ('qxsd6p', 5.5, 'desk'),   # print with likes
    ('kta16d', 4.5, 'desk'),   # topic list
    ('lj6i4p', 5.5, 'desk'),   # first unread post
    ('r3evg5', 6.5, 'phone'),  # phone: like button, PM with a quote
    ('ji2tqj', 6, 'still', {'cap': 'די ווערסיע, פון וואו עס איז אינסטאלירט, און צי עס איז דא א נייע ווערסיע',
                            'boxes': [(270, 276, 988, 314)]}),          # settings: version line
    ('seufgz', 6, 'still', {'cap': 'לינקס אינעם זעלבן טאב, און א קנעפל צוריקצושטעלן אלע אנשטעלונגען',
                            'boxes': [(455, 229, 1135, 301), (754, 478, 1135, 519)]}),  # settings: same tab, reset
    ('hzretd', 6, 'popup', {'cap': 'אייקאנס אינעם עקסטענשען מעניו, און די קאלירן באזונדער'}),  # toolbar menu
    ('wdbo80', 5, 'desk'),     # closing card
    ('n8rlfl', 6, 'desk'),     # thanks to the contributors
]
X = 0.5  # crossfade
inputs, filt = [], []
for i, (sid, d, kind, *extra) in enumerate(frames):
    extra = extra[0] if extra else {}
    f = glob.glob(os.path.join(T, f'*{sid}.jpg'))[0]
    inputs += ['-loop', '1', '-t', str(d), '-i', f]
    if kind == 'still':
        # a computer-use zoom (1389x868) of a page that can't take the overlay, like the
        # extension's settings: orange frames and the caption are drawn here
        v = 'scale=1280:800:flags=lanczos'
        for x1, y1, x2, y2 in extra.get('boxes', []):
            v += f',drawbox=x={x1}:y={y1}:w={x2 - x1}:h={y2 - y1}:color=0xFF8A00:t=4'
        v += caption(i, extra['cap'])
    elif kind == 'popup':
        # a small window, like the toolbar menu: on the blue background with the caption under it
        v = ('scale=-2:620:flags=lanczos,pad=1280:800:(ow-iw)/2:40:color=0x163a66'
             + caption(i, extra['cap']))
    elif kind == 'phone':
        # drop the taskbar strip at the bottom, put it in a dark phone bezel, and center it
        v = ('crop=iw:ih-40:0:0,scale=-2:740:flags=lanczos,'
             'pad=iw+28:ih+28:14:14:color=0x111111,'
             'pad=1280:800:(ow-iw)/2:(oh-ih)/2:color=0x163a66')
    else:
        x = kind.split(':')[1] if ':' in kind else 168
        v = f'crop=1232:770:{x}:0,scale=1280:800:flags=lanczos'
    filt.append(f'[{i}:v]{v},setsar=1,fps=30,format=yuv420p[v{i}]')
prev, offset = 'v0', 0
for i in range(1, len(frames)):
    offset += frames[i - 1][1] - X
    out = f'x{i}'
    filt.append(f'[{prev}][v{i}]xfade=transition=fade:duration={X}:offset={offset:.2f}[{out}]')
    prev = out
# standard (limited) range: the JPEG frames are full range, which some players reject
filt.append(f'[{prev}]scale=in_range=full:out_range=tv,format=yuv420p[out]')
cmd = ['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex', ';'.join(filt), '-map', '[out]',
       # yuv420p and the High profile, which every player can play (left alone, the JPEG frames
       # give 4:4:4, which most can't)
       '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-crf', '20', '-preset', 'slow',
       '-movflags', '+faststart', OUT]
subprocess.run(cmd, check=True, cwd=TMP)
print('total', round(sum(f[1] for f in frames) - X * (len(frames) - 1), 1), 's')
