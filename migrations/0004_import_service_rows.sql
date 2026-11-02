-- Only report metadata is changed; financial entries and dedupe keys are untouched.
ALTER TABLE import_batches ADD COLUMN service INTEGER NOT NULL DEFAULT 0;

WITH classified AS (
  SELECT b.id, j.key AS ordinal,
    CASE WHEN json_extract(j.value,'$.status')='rejected' AND (
      (b.source IN ('kaspi','halyk','freedom') AND json_extract(j.value,'$.reason')='служебная строка или продолжение описания')
      OR (json_extract(j.value,'$.reason')='пустая строка'
        AND json_type(j.value,'$.preview')='text'
        AND length(json_extract(j.value,'$.preview'))<140
        AND trim(json_extract(j.value,'$.preview'),' |'||char(9)||char(10)||char(13)||char(160))='')
    ) THEN json_set(j.value,'$.status','service') ELSE j.value END AS row_json
  FROM import_batches b, json_each(CASE WHEN json_valid(b.report_json) THEN b.report_json ELSE '[]' END) j
  WHERE json_valid(b.report_json) AND json_type(b.report_json)='array'
    AND json_array_length(b.report_json)=b.total
), grouped AS (
  SELECT id, sum(json_extract(row_json,'$.status')='service') AS service_count,
    sum(json_extract(row_json,'$.status')='rejected') AS rejected_count,
    json_group_array(json(row_json)) AS updated_json
  FROM (SELECT * FROM classified ORDER BY id, CAST(ordinal AS INTEGER))
  GROUP BY id
)
UPDATE import_batches SET
  service=(SELECT service_count FROM grouped WHERE grouped.id=import_batches.id),
  rejected=(SELECT rejected_count FROM grouped WHERE grouped.id=import_batches.id),
  report_json=(SELECT updated_json FROM grouped WHERE grouped.id=import_batches.id)
WHERE id IN (SELECT id FROM grouped WHERE service_count>0);
