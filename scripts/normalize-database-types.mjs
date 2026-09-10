import fs from 'node:fs';
const path=process.argv[2];let source=fs.readFileSync(path,'utf8');
// PostgreSQL permits NULL for this non-STRICT numeric argument. Generated types
// omit input nullability; retain the proven missing-opening contract explicitly.
source=source.replace(/(create_pilot_product:\s*\{[\s\S]*?p_opening_quantity: )number(?! \| null)/,'$1number | null');
fs.writeFileSync(path,source.replace(/\n*$/,'\n'));
