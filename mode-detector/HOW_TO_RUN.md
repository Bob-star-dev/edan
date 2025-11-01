# How to Run mode-detector

## Quick Start

### Option 1: Using npm script (Recommended)

From the project root directory (`d:\edan`):

```bash
cd mode-detector
npx live-server --port=8000 --open=index.html
```

Or if you have live-server installed globally:

```bash
cd mode-detector
live-server --port=8000 --open=index.html
```

### Option 2: Using Python HTTP Server (Easiest)

```bash
cd mode-detector
python -m http.server 8000
```

Then open in browser: `http://localhost:8000`

### Option 3: Using Node.js HTTP Server

```bash
cd mode-detector
npx http-server -p 8000
```

### Option 4: Using PHP Server

```bash
cd mode-detector
php -S localhost:8000
```

## Firebase Hosting Deployment

For production deployment with Firebase Hosting:

1. **Access URL**: `https://your-project.firebaseapp.com/mode-detector/`
2. **Auto-detection**: The app automatically detects Firebase hosting and uses correct paths
3. **No changes needed**: Path resolution works for both local development and Firebase

## Important Notes

1. **Local Development**: Always run the server from inside `mode-detector/` directory
   - The app expects files to be accessed with relative paths like `static/models/`
   - If you run from the root (`d:\edan`), paths will be incorrect

2. **Access URL**
   - Local: `http://localhost:8000` (when serving from `mode-detector/`)
   - Firebase: `https://your-project.firebaseapp.com/mode-detector/`

3. **Test if paths are correct**
   - Open browser DevTools → Network tab
   - Reload page
   - Check if model files return 200 OK
   - Local: `http://localhost:8000/static/models/yolov7-tiny_256x256.onnx`
   - Firebase: `https://your-project.firebaseapp.com/mode-detector/static/models/yolov7-tiny_256x256.onnx`

## Troubleshooting

### Models return 404 error

**Problem**: Model files not found (404 error)

**Solution**: 
1. Check your current directory: run `pwd` (Linux/Mac) or `cd` (Windows)
2. Make sure you're in `mode-detector/` directory
3. List files: `ls static/models/` or `dir static\models\`
4. Should see .onnx files there

### Still having issues?

Check the browser console for the exact path being requested. It should be:
- ✅ Good: `http://localhost:8000/static/models/yolov7-tiny_256x256.onnx`
- ❌ Bad: `http://localhost:8000/mode-detector/static/models/yolov7-tiny_256x256.onnx`

If you see `/mode-detector/static/...` in the path, you're running the server from the wrong directory!

