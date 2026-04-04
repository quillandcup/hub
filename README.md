# Quill & Cup Admin Portal

Internal admin dashboard for Quill & Cup attendance and engagement analytics.

## Documentation

- [Product Requirements Document (PRD)](docs/PRD.md)

## Overview

This system tracks attendance and engagement for Quill & Cup's weekly writing sessions, helping identify at-risk members and understand session popularity.

## Tech Stack

- **Frontend**: Next.js, Tailwind, Server Components
- **Backend**: Supabase, Postgres, pgmq
- **Hosting**: Vercel

## Architecture

The system uses a **medallion architecture** (bronze/silver/gold) for data transformation:
- **Bronze**: Raw data from Kajabi, Zoom, and Calendar
- **Silver**: Inferred attendance and enriched metrics
- **Gold**: Business analytics and insights

See [PRD](docs/PRD.md) for full details.
