import type { RequestHandler } from 'express';
import { config } from '../config';
import { brandLogoUrl } from '../utils/brand';

// The invite token is a URL fragment (/join#TOKEN), so it never reaches the server or its logs.
const INVITE_PAGE = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Join your friends on SplitEase</title>
<link rel="icon" href="${brandLogoUrl}" type="image/png">
<style>
  body { margin: 0; background: #f7f8f2; color: #1c2822;
         font: 18px system-ui; padding: 48px 24px; }
  main { max-width: 440px; margin: auto; }
  .brand-logo { display: block; border-radius: 28%; }
  a { display: inline-block; background: #176b50; color: white;
      padding: 16px 24px; border-radius: 24px; text-decoration: none; }
</style>
<main>
  <img class="brand-logo" src="${brandLogoUrl}" width="56" height="56" alt="SplitEase">
  <h1>Better together.</h1>
  <p>Open SplitEase and sign in to join your friend's group.</p>
  <a id="open" hidden>Open SplitEase</a>
  <p>If you haven't installed SplitEase yet, install it and reopen this link.</p>
  <p id="invalid" hidden>This invite link is incomplete. Ask your friend to share it again.</p>
</main>
<script>
  const token = location.hash.slice(1);
  if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
    const open = document.getElementById('open');
    open.href = 'splitease://join?token=' + encodeURIComponent(token);
    open.hidden = false;
  } else {
    document.getElementById('invalid').hidden = false;
  }
</script>
</html>
`;

export const inviteLandingPage: RequestHandler = (_req, res) => {
    // With a website configured, send visitors there. The browser keeps the #TOKEN fragment
    // across the redirect, so the website can still hand it to the app.
    if (config.inviteLandingUrl) {
        res.redirect(302, config.inviteLandingUrl);
        return;
    }
    res.type('html').send(INVITE_PAGE);
};
