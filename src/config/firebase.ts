import { type App, applicationDefault, initializeApp } from 'firebase-admin/app';
import { config } from '.';

let app: App | undefined;

export function firebaseConfigured(): boolean {
    return config.firebase.projectId.length > 0;
}

/**
 * The Firebase Admin app shared by Google sign-in and push delivery. Credentials come
 * from GOOGLE_APPLICATION_CREDENTIALS (a server service-account file).
 */
export function firebaseApp(): App {
    if (!firebaseConfigured()) {
        throw new Error('FIREBASE_PROJECT_ID is not configured');
    }
    if (!app) {
        app = initializeApp(
            { projectId: config.firebase.projectId, credential: applicationDefault() },
            'splitease',
        );
    }
    return app;
}
