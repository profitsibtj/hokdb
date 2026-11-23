# HOK Database

HOK Database is a static GitHub Pages application. Contains match breakdowns, standings, player statistics, tournament rosters, head-to-head records, and achievements data.

### Change the dark-mode color

Open `src/ui/styles.css`, find `--dark-accent` inside the `body.dark-mode` block, and replace its hex value. The rest of the dark palette is generated automatically from this one color.

```css
--dark-accent: #2f9e63; /* green */
--dark-accent: #d14b4b; /* red */
--dark-accent: #4f7ee8; /* blue */
--dark-accent: #9b62d6; /* purple */
```

Keep only one active `--dark-accent` declaration, save the file, and refresh the website. This changes dark mode only; the light theme is unaffected.

## Copyright

All data is provided by Level Up Indonesia.
