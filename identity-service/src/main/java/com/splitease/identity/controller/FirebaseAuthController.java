package com.splitease.identity.controller;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseToken;
import com.splitease.identity.dto.AuthResponse;
import com.splitease.identity.service.AuthService;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
public class FirebaseAuthController {
    private static final Logger LOGGER = LoggerFactory.getLogger(FirebaseAuthController.class);
    private final AuthService authService;
    private final String projectId;
    private FirebaseAuth firebaseAuth;

    public FirebaseAuthController(
            AuthService authService, @Value("${FIREBASE_PROJECT_ID:}") String projectId) {
        this.authService = authService;
        this.projectId = projectId;
    }

    private synchronized FirebaseAuth verifier() {
        if (projectId.isBlank()) {
            LOGGER.error(
                    "Firebase Google sign-in is unavailable: FIREBASE_PROJECT_ID is not"
                            + " configured");
            throw new ResponseStatusException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "Sign-in is temporarily unavailable. Please try again later.");
        }
        if (firebaseAuth == null) {
            try {
                FirebaseOptions options =
                        FirebaseOptions.builder()
                                .setProjectId(projectId)
                                .setCredentials(GoogleCredentials.getApplicationDefault())
                                .build();
                firebaseAuth =
                        FirebaseAuth.getInstance(
                                FirebaseApp.initializeApp(options, "splitease-identity"));
            } catch (java.io.IOException exception) {
                LOGGER.error(
                        "Firebase Admin credentials are unavailable. Configure"
                            + " GOOGLE_APPLICATION_CREDENTIALS with a server service-account file."
                            + " Error type: {}",
                        exception.getClass().getName());
                throw new ResponseStatusException(
                        HttpStatus.SERVICE_UNAVAILABLE,
                        "Sign-in is temporarily unavailable. Please try again later.");
            }
        }
        return firebaseAuth;
    }

    @GetMapping("/api/v1/auth/firebase/status")
    public SignInAvailability signInAvailability() {
        // Check identity-service reachability and local Firebase configuration before client
        // sign-in.
        verifier();
        return new SignInAvailability(true);
    }

    public record SignInAvailability(boolean available) {}

    @PostMapping("/api/v1/auth/firebase")
    public AuthResponse login(@Valid @RequestBody FirebaseLogin request) {
        FirebaseToken token;
        try {
            token = verifier().verifyIdToken(request.idToken(), true);
        } catch (com.google.firebase.auth.FirebaseAuthException exception) {
            throw new BadCredentialsException("Invalid Firebase credential");
        }
        Object firebaseClaim = token.getClaims().get("firebase");
        if (!(firebaseClaim instanceof java.util.Map<?, ?> firebase)
                || !"google.com".equals(firebase.get("sign_in_provider"))
                || !token.isEmailVerified()
                || token.getEmail() == null) {
            throw new BadCredentialsException("A verified Google account is required");
        }
        return authService.firebaseLogin(token);
    }

    public record FirebaseLogin(@NotBlank @Size(max = 16000) String idToken) {}
}
