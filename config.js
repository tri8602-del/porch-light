// Porch Light configuration. Holds no personal data.
// Firebase web config is public by design; access is controlled by firestore.rules + Auth.
window.PL_CONFIG = {
  firebase: {
    apiKey: "AIzaSyD-wmXCQ-ll-b_iVnz027TQyp8Rm7Y8PsI",
    authDomain: "porch-light-84ac9.firebaseapp.com",
    projectId: "porch-light-84ac9",
    storageBucket: "porch-light-84ac9.firebasestorage.app",
    messagingSenderId: "238545124886",
    appId: "1:238545124886:web:2bc308889cb15de346bf37"
  },
  // Public half of the VAPID key pair used for Web Push (the private half is a repo secret).
  vapidPublicKey: "BB-FJVowOxjNaIkeAcJAGSxqIKcW-7_YvoZCn39-2DpaIhIu6ahqxyOWA3UKxmyYmYWrL4Z2pJBuvozJd4LX54o",
  // Local testing only: ?emu=1 points the app at the Firebase emulators.
  emulator: { projectId: "demo-porch", auth: "http://127.0.0.1:9391", firestoreHost: "127.0.0.1", firestorePort: 8391 }
};
