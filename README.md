# Scene Lighting Cheat Sheet

Current lights initialized in `src/main.js`:

- **HemisphereLight** — sky color `0x9abfff`, ground color `0x0a0f1a`, intensity `0.7`.
- **DirectionalLight** (key light) — color `0xffffff`, intensity `1.2`, positioned at `(5, 8, 5)`.
- **SpotLight** (rim) — color `0xffcc88`, intensity `2.6`, distance `40`, angle `Math.PI / 5`, penumbra `0.35`, decay `1.8`, at `(-6, 6, -2)`.
- **PointLight** (fill) — color `0x66aaff`, intensity `1.4`, distance `18`, at `(0, -1.5, 3.5)`.
- **PointLight** (hero/center) — color `pointLightSettings.color` (default `#8d4bff`), intensity `2.1`, distance `14`, positioned at `(0, 0.9, 0.4)` and configurable via the UI.


