import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBPoch3TnKMzWoI1CxksiMEH2MmAvSnQp4",
  authDomain: "legalsathi-bf700.firebaseapp.com",  // ⚠️ this stays as-is
  projectId: "legalsathi-bf700",
  storageBucket: "legalsathi-bf700.appspot.com",
  messagingSenderId: "1089572301201",
  appId: "1:1089572301201:web:1a1d615f897eea1d009230",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
