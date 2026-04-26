import Store from 'electron-store';

const store = new Store({
  name: 'mi-calendario-config',
  defaults: {
    windowBounds: { width: 800, height: 600 }
  }
});

export { store };