const { initializeApp } = require('firebase/app')
const { getFirestore, doc, setDoc } = require('firebase/firestore')
const packageJson = require('../package.json')

const firebaseConfig = {
  apiKey: "AIzaSyDkFmsvBIYIkiYo-8gMooE5jJ-pAJpLdTg",
  authDomain: "zenday-297b3.firebaseapp.com",
  projectId: "zenday-297b3",
}

async function updateVersion() {
  const app = initializeApp(firebaseConfig)
  const db = getFirestore(app)
  const version = packageJson.version
  const downloadUrl = 'https://github.com/FranciscoDRA/zenday/releases/latest/download/ZenDay-Setup-' + version + '.exe'
  console.log('Publicando version ' + version + '...')
  await setDoc(doc(db, 'config', 'app'), {
    latestVersion: version,
    downloadUrl,
    releaseNotes: 'Version ' + version,
    updatedAt: new Date().toISOString()
  })
  console.log('Version ' + version + ' publicada en Firestore')
  process.exit(0)
}

updateVersion().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
