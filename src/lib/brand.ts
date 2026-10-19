// brand.ts
//
// Static asset paths for the Lambda Prep identity. Both files live in
// `public/`, so they are referenced by their root-relative URL directly
// instead of being imported through the bundler: that keeps one canonical
// copy in `public/` (the same one the favicon, OG tags and any plain-HTML
// consumers point at) rather than a second hashed copy emitted per build.

/** The Lambda Prep mark: ring + λ, `public/lambda-logo.svg`. */
export const BRAND_MARK = '/lambda-logo.svg';

/** Hero photograph on the home page, `public/student-studying.jpg`. */
export const HERO_IMAGE = '/student-studying.jpg';
