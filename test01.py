from conf import SAMPLE_INPUTS, SAMPLE_OUTPUTS
from moviepy import VideoFileClip, concatenate_videoclips
from moviepy.video import fx as vfx
import glob
import os


def generateclip(s):
    tokens = []

    # Convert input text into individual alphabet tokens
    for raw_token in s.split(" "):
        token = raw_token.strip()

        if not token:
            continue

        cleaned = token.lower()

        if cleaned.isalpha():
            # Convert words into individual letters
            if len(cleaned) > 1:
                tokens.extend(list(cleaned))
            else:
                tokens.append(cleaned)
        else:
            tokens.append(cleaned)

    print("[test01.generateclip] tokens:", tokens)
    print("[test01.generateclip] token_count:", len(tokens))

    clips = []

    alphabet_dir = os.path.join(SAMPLE_INPUTS, "alphabets")

    # Find alphabet videos
    os.chdir(alphabet_dir)

    for token in tokens:

        matched = None

        for file in glob.glob("*.mp4"):

            if token.lower() == os.path.splitext(file)[0].lower():
                matched = file
                break

        if matched:

            video_path = os.path.join(alphabet_dir, matched)

            # Load the complete alphabet video
            clip = VideoFileClip(video_path)

            print(
                "[test01.generateclip] token:",
                token,
                "file:",
                matched,
                "duration:",
                clip.duration
            )

            # IMPORTANT:
            # Do NOT limit the duration.
            # Do NOT use FadeIn/FadeOut.
            clips.append(clip)

        else:

            print(
                "[test01.generateclip] no alphabet clip matched token:",
                token
            )

    # No matching videos
    if not clips:
        print("[test01.generateclip] No clips found.")
        return

    # ---------------------------------------------------------
    # Resize all clips to the same resolution
    # ---------------------------------------------------------

    prepared_clips = []

    for index, clip in enumerate(clips):

        resized_clip = clip.with_effects([
            vfx.Resize((640, 480))
        ])

        prepared_clips.append(resized_clip)

        print(
            "[test01.generateclip] prepared clip:",
            index,
            "duration:",
            resized_clip.duration
        )

    # ---------------------------------------------------------
    # IMPORTANT:
    # Concatenate videos directly.
    #
    # There is:
    # - NO overlap
    # - NO transition
    # - NO fade
    # - NO black gap
    #
    # Each video plays completely.
    # ---------------------------------------------------------

    final_clip = concatenate_videoclips(
        prepared_clips,
        method="compose"
    )

    print(
        "[test01.generateclip] final_duration:",
        final_clip.duration
    )

    print(
        "[test01.generateclip] expected_frame_count_at_24fps:",
        int(final_clip.duration * 24)
    )

    # ---------------------------------------------------------
    # Write final video
    # ---------------------------------------------------------

    os.chdir(SAMPLE_OUTPUTS)

    print(
        "[test01.generateclip] writing output clipg.mp4"
    )

    final_clip.write_videofile(
        "clipg.mp4",
        codec="libx264",
        preset="ultrafast",
        audio=False,
        fps=24,
        logger=None,
    )

    print(
        "[test01.generateclip] finished writing output clipg.mp4"
    )

    # ---------------------------------------------------------
    # Close videos
    # ---------------------------------------------------------

    final_clip.close()

    for clip in prepared_clips:
        clip.close()

    # Return to input directory
    os.chdir(SAMPLE_INPUTS)

    print(
        "[test01.generateclip] video generation completed successfully"
    )
