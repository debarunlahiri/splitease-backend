package com.splitease.gateway;

import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class InviteLandingController {
    @GetMapping(value = "/join", produces = MediaType.TEXT_HTML_VALUE)
    public String invite() {
        return """
<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Join your friends on SplitEase</title>
<style>
  body { margin: 0; background: #f7f8f2; color: #1c2822;
         font: 18px system-ui; padding: 48px 24px; }
  main { max-width: 440px; margin: auto; }
  a { display: inline-block; background: #176b50; color: white;
      padding: 16px 24px; border-radius: 24px; text-decoration: none; }
</style>
<main>
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
""";
    }
}
