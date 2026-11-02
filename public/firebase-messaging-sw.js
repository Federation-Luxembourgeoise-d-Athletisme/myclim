/* global importScripts, firebase */
// Notifications push de myCLIM (iPhone app écran d'accueil, Android, ordinateur).
// Le SDK Firebase affiche la notification et ouvre son lien au clic
// (webpush.fcmOptions.link, voir functions/src/notifications.js).
// Garder la version alignée sur le paquet "firebase" de package.json.
importScripts("https://www.gstatic.com/firebasejs/12.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyC9KKU9yB_otypQq7B6WdvS9TPNxrMd_1E",
  authDomain: "myclim-5b5e5.firebaseapp.com",
  projectId: "myclim-5b5e5",
  storageBucket: "myclim-5b5e5.firebasestorage.app",
  messagingSenderId: "393030012618",
  appId: "1:393030012618:web:b6c3b5545672f75d10ae33",
});

firebase.messaging();
