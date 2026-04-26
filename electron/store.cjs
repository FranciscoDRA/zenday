const path = require('path')
const fs = require('fs')
const { app } = require('electron')

const getFilePath = () => path.join(app.getPath('userData'), 'tasks.json')

module.exports = {
  getTasks: () => {
    try {
      const file = getFilePath()
      if (!fs.existsSync(file)) return []
      return JSON.parse(fs.readFileSync(file, 'utf-8'))
    } catch {
      return []
    }
  },
  saveTasks: (tasks) => {
    try {
      fs.writeFileSync(getFilePath(), JSON.stringify(tasks, null, 2))
    } catch (e) {
      console.error('Error guardando tareas:', e)
    }
  }
}