# App Test Project Plan

## Goal

Build a small Android-friendly movie tracking app that can be installed from a website, store personal movie data, and eventually be hosted for free.

## Recommended Approach

Create a Progressive Web App using plain HTML, CSS, and JavaScript.

This keeps the first version simple, free, and easy to host with GitHub Pages. On Android, the app can be opened in Chrome and installed to the home screen with "Add to Home screen."

## Data Storage Plan

For the first version, use local browser storage.

Best fit:

- `IndexedDB` for structured movie records
- Optional `localStorage` for simple app settings

Movie records could include:

- Movie title
- Cover art URL or local cover path
- Personal rating
- Watchlist status
- Watched status
- Description or notes
- Date added
- Date updated

This works offline and costs nothing. The main tradeoff is that the data stays on the device/browser unless we later add export/import or cloud sync.

## Future Cloud Option

If sync across devices becomes important, add Supabase later.

Supabase could provide:

- A small hosted database
- Optional user login
- Cross-device sync
- Backup
- Poster image storage if needed

Possible table:

```txt
movies
- id
- title
- cover_url
- rating
- watchlist
- watched
- description
- created_at
- updated_at
```

## Hosting Plan

Host the app for free using GitHub Pages.

Basic path:

1. Put the app files in a GitHub repository.
2. Enable GitHub Pages.
3. Open the published URL on Android.
4. Install it from Chrome using "Add to Home screen."

## First Build

Start with a simple Hello World PWA shell:

- `index.html`
- `styles.css`
- `app.js`
- `manifest.json`
- `sw.js`

Then build up the movie features one step at a time.

## Current Checkpoint

The app has moved beyond the initial shell and now includes a functioning browse experience for the full 1950s movie grid plus an early random-pick workflow.

Implemented so far:

- Year-by-year horizontal cover rows with expand/collapse controls
- IndexedDB-backed movie records synced from the catalog CSV
- Detail card overlay with responsive desktop and mobile layouts
- Enriched movie metadata in the detail card, including director, cast, runtime, Wikipedia, and IMDb links
- Favorite, thumbs up, thumbs down, and watch-later calendar actions in the detail card
- Watched-state updates tied to thumbs selection with live year progress updates
- Ticket-style stub treatment on grid cards with visibility toggles for title, studio, and ratings
- Persistent `Show:` toolbar preferences saved in local storage
- Responsive decade navigation that expands when space allows and scrolls when it does not
- Random top-bar action wired to an animated ticket-printer picker for unwatched movies
- Revealed random tickets can be pressed again to cut away the ticket stub, animate the cover back to its grid card, and open the full detail card
- Top-bar action buttons reserved for filter and search
- Real movie coverage for 1950 through 1959 with imported poster art
- Metadata-backed catalog import for the 1950s dataset
- Tied-rank handling using a stable internal sequence separate from displayed rank

## Ready For Next Step

The current UI checkpoint should be committed as a milestone before the next feature pass.

Most likely next work areas:

- Hook the top-bar filter and search buttons to real behavior
- Tune the random ticket handoff timing after device testing
- Add deeper filtering and search flows
- Expand beyond the 1950s into additional decade datasets
- Add richer editing inside the detail card
