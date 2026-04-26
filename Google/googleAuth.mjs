import { google } from "googleapis"
import readline from "readline"

const CLIENT_ID = "551213988909-k7av6fe6p0stsfn6uibmcrk8pefscnhb.apps.googleusercontent.com"
const CLIENT_SECRET = "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"
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob"

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
)

// Generar URL de login
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  scope: ["https://www.googleapis.com/auth/calendar"]
})

console.log("Abrí este link en el navegador:\n", authUrl)

// Leer código del usuario
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

rl.question("Pegá el código acá: ", async (code) => {
  const { tokens } = await oAuth2Client.getToken(code)
  oAuth2Client.setCredentials(tokens)

  console.log("Login exitoso ✅")

  listarEventos(oAuth2Client)
  rl.close()
})