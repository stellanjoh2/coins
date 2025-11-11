# Scene Lighting Cheat Sheet

Current lights initialized in `src/main.js`:

- **HemisphereLight** — sky/ground colors and intensity now configurable from the “Hemisphere Light” UI section.
- **DirectionalLight** (key light) — color & strength configurable in the “Key Light” controls; default position `(5, 8, 5)`.
- **SpotLight** (rim) — color & strength configurable in the “Rim Light” section; default position `(-6, 6, -2)` with fixed cone settings.
- **PointLight** (fill) — color & strength exposed in the “Fill Light” controls; default position `(0, -1.5, 3.5)`.

All other lights have been removed; any updates to the UI sliders are applied live and included in the “Copy Settings” payload.


