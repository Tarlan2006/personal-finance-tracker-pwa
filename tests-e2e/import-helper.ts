import type {Page} from '@playwright/test';
export async function importStatement(page:Page){
 await page.getByRole('button',{name:'Импортировать',exact:true}).click();
 await page.getByRole('dialog',{name:'Подтвердить импорт',exact:true}).getByRole('button',{name:'Подтвердить импорт',exact:true}).click();
}
