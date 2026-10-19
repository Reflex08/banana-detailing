# Banana Detailing — CRM

Single-file CRM for a car-detailing business. No build step, no dependencies, no server:
`index.html` is the whole app, and it keeps working offline once the page has loaded.

**Live:** https://reflex08.github.io/banana-detailing/

## What it does

Schedule (rolling 7-day strip) · clients and leads · jobs with vehicle details ·
quotes with Accept & Sign · revenue dashboard against a $5,000/month goal · text templates
that hand off to the phone's own SMS app.

## Where the data lives

Everything is in the browser's `localStorage` under the `banana.*` keys. Nothing is sent
anywhere by default.

> **Clearing browser data erases the CRM.** Settings → Data → **Backup now** writes a full
> copy to one file. Use it.

Optional PC ⇄ phone sync keeps the database in a single private GitHub Gist
(`banana-db.json`). It needs a personal access token with only the `gist` scope, created on
the account that owns the data and pasted into Settings on each device. Sync is
last-write-wins across the whole database — it does not merge record by record, so avoid
editing the same day on two devices while one of them is offline.

## Sample data

Ships with five fake clients and a week of jobs so the schedule isn't empty on first open.
Settings → Data → **Remove sample data** deletes exactly those and nothing you added
yourself.

## Installing on a phone

Open the live link, then "Add to Home Screen". It launches fullscreen.
