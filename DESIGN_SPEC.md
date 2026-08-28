# TuringMx — UI Design Specification

## 1. Design Direction

TuringMx utiliza un lenguaje visual:

**Soft Futuristic Corporate**

La interfaz debe transmitir:

- tecnología
- confianza
- sofisticación
- claridad
- fluidez
- modernidad

Debe evitar una estética excesivamente empresarial tradicional o un dashboard SaaS genérico.

---

## 2. Visual Principles

### Minimal
Mostrar únicamente la información necesaria.

### Spacious
Utilizar whitespace amplio.

### Soft
Evitar contrastes agresivos y bordes pesados.

### Futuristic
Utilizar profundidad, luz, transparencias y movimiento sutil.

### Functional
Los elementos visuales nunca deben dificultar el uso.

---

## 3. Core Palette

### Background

Base:
#EEF0FF
#F4F1FF
#E7EDFF

### Primary

Indigo:
#4F5CF0

Violet:
#7157F7

### Accent

Magenta:
#C83BFF

### Text

Primary:
#27366E

Secondary:
#6070A8

Muted:
#7F8BB5

### Glass

Background:
rgba(255,255,255,0.20–0.45)

Border:
rgba(255,255,255,0.30–0.55)

---

## 4. Gradients

Primary text:

linear-gradient(
  90deg,
  #4357EF,
  #6550F8,
  #C533FF
)

Background:

linear-gradient(
  180deg,
  #F0EBFF,
  #E5ECFF
)

Ambient gradients should remain low contrast.

---

## 5. Radius

Large containers:
24–32px

Cards:
20–26px

Pills:
999px

Small controls:
10–14px

Avoid excessive rounding on every component.

---

## 6. Glassmorphism

Use:

background: rgba(255,255,255,.20);

backdrop-filter:
blur(14px)
saturate(140%);

border:
1px solid rgba(255,255,255,.35);

Glass effects should remain subtle.

Do not turn every component into glass.

---

## 7. Shadows

Use broad atmospheric shadows.

Example:

0 20px 50px rgba(90,100,170,.10)

Avoid:

- black shadows
- sharp shadows
- heavy elevation

---

## 8. Typography

Use a clean sans-serif.

Preferred:

Inter
Geist
Manrope
Plus Jakarta Sans

Hero:

font-weight: 700–800
letter-spacing: -0.03em to -0.05em

Body:

font-weight: 400–500

---

## 9. Hero Typography

Desktop:

Hero:
64–108px

Secondary heading:
22–38px

Description:
17–24px

Mobile sizes should use clamp().

---

## 10. Navigation

Desktop layout:

TuringMx        Dashboard   Daily        Usuario

Navigation should remain inside a translucent floating top bar.

No permanent sidebar.

Active item should be visually distinguishable through:

- light glass background
- underline
- subtle glow

Avoid heavy active states.

---

## 11. Motion Language

All animation should communicate:

calm
precision
fluidity

Preferred easing:

cubic-bezier(.22,1,.36,1)

Typical entrance duration:

700–1000ms

Use stagger delays.

Entrance pattern:

opacity:
0 → 1

translateY:
20px → 0

blur:
8px → 0

---

## 12. Ambient Motion

Blob movement:

10–16 seconds

Halo breathing:

7–10 seconds

Movement amplitude:

5–15px maximum.

Movement should almost be subconscious.

---

## 13. Page Entry Sequence

0ms:
background

200ms:
navbar

350ms:
ambient shapes

500ms:
kicker

650ms:
headline

800ms:
description

1000ms:
secondary content

---

## 14. Decorative Elements

Allowed:

- translucent blobs
- subtle spheres
- mesh patterns
- glow rings
- thin light waves
- sparse particles
- radial gradients

Avoid:

- characters
- robots
- stock illustrations
- dense particles
- cyberpunk imagery
- random 3D assets

---

## 15. Cards

Cards should:

- contain little information
- use generous spacing
- use subtle borders
- use minimal icons
- remain visually secondary

Never use a card just because content exists.

---

## 16. Buttons

Primary buttons:

gradient or indigo.

Secondary:

glass / translucent.

Use:

hover
active
focus-visible

Microinteraction:

translateY(-1px or -2px)

Avoid exaggerated scaling.

---

## 17. Icons

Use one consistent icon library.

Recommended:

Lucide

Stroke style.

Avoid mixing:

filled icons
emoji
multiple icon packs

---

## 18. Performance

Prefer:

CSS
SVG
transform
opacity

Avoid unnecessary:

Three.js
WebGL
canvas
large video backgrounds
hundreds of particles

Visual sophistication must not sacrifice performance.

---

## 19. Accessibility

Always support:

prefers-reduced-motion

Maintain contrast.

Interactive elements must support keyboard navigation.

Decorative visual elements:

aria-hidden="true"

---

## 20. UX Rule

Every screen should answer immediately:

1. Where am I?
2. What can I do here?
3. What deserves my attention?

Visual decoration should never interfere with those three questions.