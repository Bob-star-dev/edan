# Firebase Hosting Deployment Fix

## Problem

Mode-detector was failing to load model files when deployed to Firebase Hosting. Models returned 404 errors because the app uses relative paths (`static/models/...`) but Firebase Hosting serves from the root directory, so paths needed to be `/mode-detector/static/models/...`.

## Solution

### 1. Firebase Configuration (`firebase.json`)

Added specific rewrite rule for mode-detector to be served properly:

```json
"rewrites": [
  {
    "source": "mode-detector/**",
    "destination": "/mode-detector/index.html"
  },
  {
    "source": "map/**",
    "destination": "/map/map.html"
  },
  {
    "source": "**",
    "destination": "/index.html"
  }
]
```

### 2. Auto-Detection Logic (`js/model.js`)

Added `getStaticBasePath()` function that detects deployment context:

- **Firebase Hosting**: Returns `/mode-detector/static` when URL path starts with `/mode-detector/`
- **Local Development**: Returns `static` for relative paths when serving from `mode-detector/` directory

```javascript
function getStaticBasePath() {
  const path = window.location.pathname;
  if (path.startsWith('/mode-detector/') || path.startsWith('/mode-detector')) {
    return '/mode-detector/static';
  }
  return 'static';
}
```

### 3. Model Loading Update

Updated `loadModel()` function to use the auto-detected base path:

```javascript
const staticBase = getStaticBasePath();
const modelUrl = `${staticBase}/models/${modelName}`;
```

## How to Deploy

### Local Development

```bash
cd mode-detector
python -m http.server 8000
# Then open: http://localhost:8000
```

### Firebase Hosting

```bash
firebase deploy
# Then open: https://your-project.firebaseapp.com/mode-detector/
```

## What Changed

### Files Modified

1. **firebase.json** - Added mode-detector rewrite rule
2. **mode-detector/js/model.js** - Added path detection logic
3. **mode-detector/HOW_TO_RUN.md** - Added Firebase deployment instructions

### Files Created

1. **mode-detector/FIREBASE_DEPLOYMENT_FIX.md** - This documentation

## Testing

### Local Development Test

1. `cd mode-detector`
2. `python -m http.server 8000`
3. Open `http://localhost:8000`
4. Check browser console for: `Loading model: static/models/yolov7-tiny_256x256.onnx`
5. Should see 200 OK in Network tab

### Firebase Hosting Test

1. `firebase deploy`
2. Open `https://your-project.firebaseapp.com/mode-detector/`
3. Check browser console for: `Loading model: /mode-detector/static/models/yolov7-tiny_256x256.onnx`
4. Should see 200 OK in Network tab

## Benefits

- ✅ Works in both local development and Firebase hosting
- ✅ No manual configuration needed
- ✅ Automatic path detection
- ✅ No breaking changes to existing code
- ✅ Clear error messages if paths are wrong

## Additional Notes

- The app now supports both deployment methods seamlessly
- Path detection is automatic and requires no user intervention
- All static files (models, WASM) use the same base path logic
- Firebase hosting URL: `https://your-project.firebaseapp.com/mode-detector/`

