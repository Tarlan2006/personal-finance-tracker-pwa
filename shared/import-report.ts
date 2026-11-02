export const LEGACY_SERVICE_REASON='служебная строка или продолжение описания';
export const PDF_BANKS=['kaspi','halyk','freedom'];
export type RowStatus='imported'|'duplicate'|'rejected'|'service';
export interface ImportRow {line:number;status:RowStatus;reason?:string;preview?:string;text?:string}

/** Read compatibility for an old Worker finishing an import during deployment. */
export function presentImportReport<T extends {total:number;imported:number;duplicates:number;rejected:number;service?:number;rows:ImportRow[]}>(report:T,source:string):T&{service:number}{
 if(report.rows.length!==report.total)return {...report,service:report.service??0};
 const rows=report.rows.map(row=>row.status==='rejected'&&((PDF_BANKS.includes(source)&&row.reason===LEGACY_SERVICE_REASON)||(row.reason==='пустая строка'&&typeof row.preview==='string'&&row.preview.length<140&&/^[\s|]*$/.test(row.preview)))?{...row,status:'service' as const}:row);
 const service=rows.filter(r=>r.status==='service').length;
 const rejected=rows.filter(r=>r.status==='rejected').length;
 return {...report,rows,service,rejected};
}
