// Porch Light configuration. Holds no personal data.
// Firebase web config is public by design; access is controlled by firestore.rules + Auth.
window.PL_CONFIG = {
  firebase: {
    apiKey: "AIzaSyDCRuAN_PM_bmVSHVl-kEsiszproydi7dA",
    authDomain: "territory-tracker-e44f2.firebaseapp.com",
    projectId: "territory-tracker-e44f2",
    storageBucket: "territory-tracker-e44f2.firebasestorage.app",
    messagingSenderId: "1084862266247",
    appId: "1:1084862266247:web:1d0b2b03144b7502a57122"
  },
  // Public half of the VAPID key pair used for Web Push (the private half is a repo secret).
  vapidPublicKey: "BB-FJVowOxjNaIkeAcJAGSxqIKcW-7_YvoZCn39-2DpaIhIu6ahqxyOWA3UKxmyYmYWrL4Z2pJBuvozJd4LX54o",
  // Local testing only: ?emu=1 points the app at the Firebase emulators.
  emulator: { projectId: "demo-porch", auth: "http://127.0.0.1:9391", firestoreHost: "127.0.0.1", firestorePort: 8391 }
};
