import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getDatabase } from 'firebase/database'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyDkFmsvBIYIkiYo-8gMooE5jJ-pAJpLdTg",
  authDomain: "zenday-297b3.firebaseapp.com",
  databaseURL: "https://zenday-297b3-default-rtdb.firebaseio.com",
  projectId: "zenday-297b3",
  storageBucket: "zenday-297b3.firebasestorage.app",
  messagingSenderId: "736880943965",
  appId: "1:736880943965:web:f207c8d492de342e1afeb4"
}

const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db = getDatabase(app)
export const firestore = getFirestore(app)