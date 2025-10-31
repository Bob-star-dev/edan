import "../styles/globals.css";
import type { AppProps } from "next/app";
import { useEffect } from "react";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    // Configure ONNX Runtime Web to use the correct paths for WASM files
    // This ensures WASM files are loaded from the correct location in Next.js
    if (typeof window !== 'undefined') {
      // Set the path where ONNX Runtime Web can find WASM files
      import('onnxruntime-web').then((ort) => {
        ort.env.wasm.wasmPaths = '/static/wasm/';
      }).catch((error) => {
        console.error('Failed to configure ONNX Runtime Web:', error);
      });
    }
  }, []);

  return (
    <>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <Component {...pageProps} />
    </>
  );
}
