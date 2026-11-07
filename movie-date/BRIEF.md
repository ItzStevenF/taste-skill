# Creative brief — “Loading a movie date…”

A one-link website a man sends to his fiancée to ask her on a movie date. It opens on her iPhone
(Safari, or the in-app browser of whatever app she taps the link in).

## The job

In about six seconds, make her feel she has walked into a private screening made for two of them,
ask the question as the film’s title card, let her answer with one tap, then land the joke: the
website “breaks” and can’t tell what she picked, so she has to text him.

## The idea

**On this page, the date itself becomes the film:** the camera pushes past the two of them into the
screen, and her question is the movie’s opening title. The ending is the projector failing on cue:
the polish breaking down is the punchline (“This website was rushed…”).

Competitor test: the stock “Will you go out with me?” page with a runaway NO button. This idea does
not transfer to it; it only works for a movie date.

## Direction

Dealt by the taste-skill draw: **“The place carries it.”** One full-bleed photograph of where she
would be sitting fills the first screen and the design steps back. Adapted here: the photograph is
turned into a 3D space (depth map → mesh) that a real perspective camera travels through, so rows
pass under the lens at their own speeds instead of the picture simply scaling.

Redraws: type was redrawn once (dealt Clash Grotesk, then Barlow Condensed — an agency grotesk and
a road-sign condensed face, neither able to carry a romantic film title). The face is chosen from the
skill’s own serif systems by specimen test. The dealt palette (green-black + jade) is replaced by the
subject’s own colours, keeping the dealt proportions (one ground, one ink, one accent).

## Palette (from the room itself)

| Role | Colour | Source |
| --- | --- | --- |
| Ground | `#0b0908` warm projector-black | the dark house |
| Surface | `#17110f` | seat shadow |
| Ink | `#efe4d0` | screen light |
| Muted | `#a39684` | |
| Accent (YES only) | `#d6a75c` | the brass sconces |
| Field (the cheeky answer) | `#6b1726` | the velvet |

No gradients, glows or shadows in the interface. Light and falloff live only inside the photograph
and the projection, where light is the subject.

## Sequence (≈5.5 s to a readable invitation)

1. 0.0 s black → 0.2–1.0 s house lights come up: amber sconces, the couple visible from behind.
2. 1.0 s the projector strikes: the screen flickers on, light spills over the seat tops and rims
   the couple; a faint beam with dust in the haze.
3. 1.4 s “Loading a movie date…” is projected on the screen (the dots step).
4. 1.2–5.0 s camera dolly through the depth mesh: slow start, accelerating, it passes over the
   couple (they leave the bottom of the frame ≈3.6 s), rows slide under the lens, the screen fills
   the frame ≈5.0 s.
5. 5.0–5.6 s shutter: the frame drops to black; the title card fades up with a projector focus
   pull, then the signature, then the three answers.

## The words (exact)

- Screen: “Loading a movie date…”
- Title: “Do you want to go on a movie date with me?”
- Signature: “Love – Fiancee” (typeset with an en dash)
- Answers: “YES”, “NO”, “Let’s stay in and just make out”
- Final: “This website was rushed, I can’t find out what option you picked. Please text me with your
  answer lol”

Nothing else is added to the joke.

## Answers

Three flat, ticket-cut buttons (notched ends): YES in brass, NO in charcoal, side by side; the long
cheeky one in velvet burgundy across the full width below. ≥56 px tall. Press: scale 0.97 and a
brighter fill. NO never moves or shrinks.

## Finale (identical for all three)

Tap → the film slips in the gate (frame roll and jitter) → a film burn blooms and eats the frame →
bare warm projector light → the exact message, like a hastily slotted glass slide, slightly crooked,
weave settling within a second. Nothing is stored or sent; the choice is never shown.

## Sound

Off by default; a small “Sound” control. When she turns it on: room tone, projector clatter, a soft
swell for the title, film flap and pop for the failure. Never plays without her tap.

## Review round 1 — Creative Director challenge, and what changed

| Challenge | Decision |
| --- | --- |
| House lights come *up* at the start; cinemas dim them | Adopted. Warm house light first, sconces bright; they sink to embers as the projector strikes and the screen lights the room. |
| Arrival fills the phone with near-white, then cuts to black: a flashbang at night | Adopted. The projection dims to a dark frame while the camera arrives; the title fades up on the same darkness. |
| Burn → bare lamp is a transition preset and a white flash | Adopted. Frame roll with the frame line → freeze → cut to black → a beat of grain-only darkness → the message drops in like a crooked slide, on dark. |
| Ticket notches are theme-park; three fills read as a traffic light | Adopted the shape: three equal full-width rows, square corners, one surface tone; a press fills the row with brass. Kept the client's personalities, expressed by hue only (YES in brass type, the cheeky one on velvet). |
| One depth mesh will smear like a rubber sheet | Rejected with evidence: stretch is detected per pixel and shaded as the shadow between rows; rendered frames read as looking down over seats. |
| Re-pose the couple (hands low on the armrest) | Rejected: the clasped hands are clearly visible now, which the brief requires; lower hands would hide behind the seat backs. |
| Grain every frame, also over the title and buttons; warmer, hotspotted screen with texture up close; ring glint; link preview; tap to fast-forward | Adopted. |
| Old-style serif (EB Garamond) instead of Newsreader | Open: judged in context on the final render. |

## Review round 2 — on the rendered build (2× iPhone frames, seven viewports)

The independent final-CD and QA reviewers were cut off by an account usage limit before reporting,
so this round was judged in-house against `references/critique.md`.

```
ROUND 2
Seen in one second: a lit cinema screen over two people holding hands.
Idea: the date itself becomes the film; the projector failing on cue is the punchline.
Live thing: her answer (any of three) breaks the projector; sound she can switch on.
Scores: design 8 · usability 8.5 · creativity 8.5 · content 8 → overall 8.3
Caps: the page-level "four real pictures" cap is not applied to a one-screen invitation (one
photograph, used as a 3D space, is the whole show).
Fixed this round:
1. Stair-step tearing behind the couple as the camera rose → depth-aware rack focus on the
   screen (WebGL2 pass), denser mesh (384 columns), tighter stretch shading.
2. Focus left the couple too early (soft by 1.9 s) → held sharp until the words land, racked
   1.6–2.4 s, motivated by the projection.
3. YES read as one dark row among three → brass fill (the client asked for an inviting YES);
   each answer brightens in its own material on press.
Still short: the stage-front lamp smears for ~0.4 s as the camera crosses the stage (≈3.9 s);
near rows show soft stretched texture under the blur at 2.9–3.4 s; not run on a physical iPhone
(Chromium with software WebGL; WebKit is not installed here).
```

## Phone rules

Full-height with `svh`/`dvh`, safe-area insets, no page scroll, thumb-sized targets, works in the
Messages/Instagram in-app browsers, reduced motion = crossfades only (no dolly, no jitter).
