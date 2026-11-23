// shared Chrome launcher with WebGPU on the Intel Arc (needs a localhost/https origin).
// Headless by default: frames are read back in-page (grab.mjs). Headed under Xvfb loses the WebGPU device.
import { chromium } from 'playwright-core';
const HEADLESS = process.env.HEADLESS !== '0';
export const ARGS = ['--ignore-gpu-blocklist','--enable-gpu','--enable-unsafe-webgpu','--use-angle=vulkan',
  '--enable-features=Vulkan', ...(HEADLESS ? ['--disable-vulkan-surface'] : []), '--disable-gpu-vsync','--disable-frame-rate-limit',
  '--window-size=1920,1080','--window-position=0,0'];
export async function launch() { return chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: HEADLESS, args: ARGS }); }
