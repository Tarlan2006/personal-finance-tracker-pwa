import{it,expect,vi}from'vitest';
const proxy=vi.hoisted(()=>vi.fn());vi.mock('unpdf',()=>({getDocumentProxy:proxy}));
import{bankPdf}from'../src/domain/money/bank-pdf';
import{parseRows}from'../src/domain/money/import';
it('PDF: строки с плохой датой/суммой не скрываются среди служебных',async()=>{
 const item=(str:string,x:number,y:number)=>({str,transform:[1,0,0,1,x,y]});
 const items=[item('Kaspi',50,800),item('Дата',59,700),item('Сумма',133.6,700),item('Операция',243,700),item('Детали',311.5,700)];
 for(const [y,date,amount]of [[660,'01.11.26','-1,00 ₸'],[630,'BAD DATE','-2,00 ₸'],[600,'BAD DATE','ABC']] as const)items.push(item(date,59,y),item(amount,110,y),item('Покупка',243,y),item('SYNTHETIC SHOP',311.5,y));
 items.push(item('SYNTHETIC BANK FOOTER',59,570));
 proxy.mockResolvedValue({numPages:1,getPage:async()=>({getTextContent:async()=>({items}),getViewport:()=>({width:595.3,height:841.9})}),cleanup:async()=>{}});
 const csv=await bankPdf(btoa('%PDF-SYNTHETIC'),'kaspi');const {parsed}=parseRows(csv,{bank:'kaspi',dateCol:0,amountCol:1,counterpartyCol:2,noteCol:3,rejectionCol:6,serviceCol:7,delimiter:';'});
 expect(parsed.filter(r=>r.payload)).toHaveLength(1);expect(parsed.filter(r=>r.reject)).toHaveLength(2);expect(parsed.filter(r=>r.service)).toHaveLength(1);expect(parsed[3].text).toBe('SYNTHETIC BANK FOOTER');
});
it('Halyk: сводка валюты служебная, а строка с плохой датой и кредитом отклонена',async()=>{
 const item=(str:string,x:number,y:number)=>({str,transform:[1,0,0,1,x,y]});
 const items=[item('Halyk',30,800),item('Transaction description',110,700)];
 for(const [y,date]of [[660,'01.11.2026'],[630,'BAD']] as const)items.push(item(date,30,y),item('SYNTHETIC',120,y),item('KZT',270,y),item('2,00',320,y),item('0,00',380,y));
 items.push(item('KZT',30,600),item('2,00',320,600),item('-2,00',380,600));
 proxy.mockResolvedValue({numPages:1,getPage:async()=>({getTextContent:async()=>({items}),getViewport:()=>({width:595.3,height:841.9})}),cleanup:async()=>{}});
 const csv=await bankPdf(btoa('%PDF-SYNTHETIC'),'halyk');const {parsed}=parseRows(csv,{bank:'halyk',dateCol:0,creditCol:4,debitCol:5,counterpartyCol:2,noteCol:3,rejectionCol:6,serviceCol:7,delimiter:';'});
 expect(parsed.filter(r=>r.payload)).toHaveLength(1);expect(parsed.filter(r=>r.reject)).toHaveLength(1);expect(parsed.filter(r=>r.service)).toHaveLength(1);
});
