import {defineConfig} from '@playwright/test';
import base from './playwright.config';

// Viewport/engine checks only: these are not physical iPhones or an iOS keyboard.
const phones=[['iPhone11',414,896,2],['iPhone12',390,844,3],['iPhone13',390,844,3],['iPhone14',390,844,3]] as const;
export default defineConfig({...base,testMatch:'ux-audit.ts',projects:(['light','dark'] as const).flatMap(colorScheme=>[
 ...phones.map(([name,width,height,deviceScaleFactor])=>({name:`ux-${name}-${colorScheme}`,use:{browserName:'webkit' as const,viewport:{width,height},deviceScaleFactor,isMobile:true,hasTouch:true,colorScheme,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'}})),
 {name:`ux-laptop-${colorScheme}`,use:{browserName:'chromium' as const,viewport:{width:1366,height:768},deviceScaleFactor:1,isMobile:false,hasTouch:false,colorScheme}},
])});
