
'use strict';

const stages = [
  {id:'new',name:'Лид',color:'sprout'},
  {id:'missed',name:'НДЗ',color:'moss'},
  {id:'missed2',name:'НДЗ 2',color:'fern'},
  {id:'substitution',name:'Подменка',color:'sage'},
  {id:'talking',name:'Переговоры',color:'jade'},
  {id:'success',name:'Анкета',color:'mint'},
  {id:'ticket',name:'Билет',color:'sprout'},
  {id:'preparing',name:'Готовится к отправке',color:'sage'},
  {id:'travel',name:'В пути',color:'fern'},
  {id:'signing',name:'На подписании',color:'jade'},
  {id:'won',name:'Сделка успешна',color:'canopy'}
];
const archivedStage = {id:'declined',name:'Отказ',color:'archive-tone'};
const callbackStage = {id:'callback',name:'Перезвонить позже',color:'callback-tone'};
const removedStage = {id:'import-removed',name:'Убрано из загрузки',color:'archive-tone'};
const separateViews = {callback:callbackStage,archive:archivedStage};
const allStages = [...stages,...Object.values(separateViews)];
const stageById = Object.fromEntries([...allStages,removedStage].map(stage => [stage.id,stage]));
const fields = [
  {id:'name', label:'ФИО / имя', aliases:['фио','ф и о','фамилия имя отчество','фио кандидата','фио соискателя','имя','имя кандидата','имя соискателя','имя откликнувшегося','кандидат','соискатель','applicant','candidate','name','full name','full_name']},
  {id:'phone', label:'Телефон', aliases:['телефон','номер','номер телефона','номер кандидата','телефон кандидата','телефон соискателя','контактный телефон','мобильный телефон','мобильный','контакт','контакты','phone','phone number','phone_number','tel']},
  {id:'job', label:'Вакансия / объявление', aliases:['вакансия','название вакансии','название объявления','заголовок объявления','объявление','название','должность','наименование вакансии','позиция','vacancy','job','title','ad title','ad_title']},
  {id:'date', label:'Дата отклика', aliases:['дата','дата отклика','время отклика','дата и время отклика','дата создания','дата создания отклика','дата получения','отклик от','created at','created_at','date','response date']},
  {id:'sourceId', label:'ID отклика', aliases:['id отклика','ид отклика','номер отклика','идентификатор отклика','id заявки','id','response id','response_id','application id','application_id']},
  {id:'adId', label:'ID объявления', aliases:['id объявления','ид объявления','номер объявления','id вакансии','vacancy id','ad id','ad_id','item_id']},
  {id:'callStatus', label:'Статус обзвона', aliases:['статус обзвона','статус звонка','результат звонка','результат обзвона','обзвонен','обзвонено','звонили','статус','call status','called']},
  {id:'callAttempts', label:'Попытки дозвона', aliases:['попытки дозвона','число звонков','количество звонков','попытки обзвона','call attempts','calls']}
];
const asText = value => String(value ?? '').trim();
const clean = value => asText(value).toLowerCase().replaceAll('ё','е').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
const digits = value => asText(value).replace(/\D/g,'');
function phoneKey(value) {
  const number = digits(asText(value).replace(/\s+(?:доб\.?|ext\.?|#)\s*\d+$/i,''));
  if(number.length === 10) return '7' + number;
  if(number.length === 11 && number.startsWith('8')) return '7' + number.slice(1);
  return number;
}
function formatPhone(value) {
  const text = asText(value);
  const number = phoneKey(text);
  const parts = /^(7)(\d{3})(\d{3})(\d{3})(\d)$/.exec(number);
  const extension = text.match(/\s+(?:доб\.?|ext\.?|#)\s*\d+$/i)?.[0] ?? '';
  return parts ? parts.slice(1).join('-') + extension : text;
}
function identityKeys(contact) {
  const phone = phoneKey(contact.phone);
  const keys = new Set();
  if(phone.length >= 7) keys.add('phone:' + phone);
  if(contact.sourceId) keys.add('id:' + clean(contact.sourceId));
  for(const key of contact.responseKeys ?? []) if(key.startsWith('id:')) keys.add(key);
  const name = clean(contact.name);
  if(name) {
    const date = responseDate(contact.date);
    const job = clean(contact.adId || contact.job);
    keys.add('row:' + JSON.stringify([name,job,date ? localDay(date) : clean(contact.date)]));
    if(date && contact.adId && contact.job) keys.add('row:' + JSON.stringify([name,clean(contact.job),localDay(date)]));
  }
  return keys;
}
function candidateIndex(contacts) {
  const indexes = new Map();
  function add(contact) {
    for(const key of identityKeys(contact)) {
      if(!indexes.has(key)) indexes.set(key,new Set());
      indexes.get(key).add(contact.id);
    }
  }
  for(const contact of contacts) add(contact);
  return {
    add,
    find(incoming,records) {
      const incomingPhone = phoneKey(incoming.phone);
      for(const key of identityKeys(incoming)) {
        const matches = [];
        for(const id of indexes.get(key) ?? []) {
          const record = records.get(id);
          if(!record) continue;
          const savedPhone = phoneKey(record.phone);
          if(key.startsWith('row:')) {
            if(incomingPhone.length >= 7 && savedPhone.length >= 7 && incomingPhone !== savedPhone) continue;
            if(incoming.sourceId && record.sourceId && clean(incoming.sourceId) !== clean(record.sourceId)) continue;
          }
          matches.push(record);
        }
        if(matches.length === 1 || (matches.length > 1 && !key.startsWith('row:'))) return matches[0];
      }
      return null;
    }
  };
}
function responseDate(value) {
  const text = asText(value);
  if(!text) return null;
  const ru = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  const parts = ru ? [ru[3],ru[2],ru[1],ru[4],ru[5],ru[6]] : iso?.slice(1);
  if(parts) return new Date(Number(parts[0]),Number(parts[1])-1,Number(parts[2]),Number(parts[3] || 0),Number(parts[4] || 0),Number(parts[5] || 0));
  const date = /^\d{4}-\d{2}-\d{2}T/.test(text) ? new Date(text) : null;
  return Number.isFinite(date?.valueOf()) ? date : null;
}
function localDay(date=new Date()) {
  return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
}
function calendarDays(from,to) {
  const day = date => Date.UTC(date.getFullYear(),date.getMonth(),date.getDate());
  return Math.max(0,(day(to)-day(from))/86400000);
}
function firstResponse(contact) {
  const first = responseDate(contact.firstResponseDate);
  const current = responseDate(contact.date);
  if(first && current) return first < current ? first : current;
  return first || current;
}
function previousResponseDate(contact) {
  let first = responseDate(contact.date);
  for(const event of contact.events ?? []) {
    const date = responseDate(event.date);
    if(date && (!first || date < first)) first = date;
  }
  for(const key of contact.responseKeys ?? []) {
    if(!key.startsWith('[')) continue;
    try {
      const [value] = JSON.parse(key.replace(/#\d+$/,''));
      if(typeof value !== 'number') continue;
      const date = new Date(value);
      if(Number.isFinite(date.valueOf()) && (!first || date < first)) first = date;
    } catch {}
  }
  return first?.toISOString() ?? '';
}
function leadAge(contact,now=new Date()) {
  const response = firstResponse(contact);
  const creation = contact.events?.find(event => event.kind === 'import')?.at ?? contact.updatedAt;
  const origin = response || new Date(creation);
  if(!Number.isFinite(origin.valueOf())) return null;
  return {days:calendarDays(origin,now),origin,response:Boolean(response)};
}
const birthLabels = new Set(['дата рождения','дата рождения кандидата','дата рождения соискателя','birth date','birthday','date of birth']);
const ageLabels = new Set(['возраст','возраст кандидата','возраст соискателя','возраст лет','полных лет','сколько лет','age']);
const cityLabels = new Set(['город','город кандидата','город соискателя','город проживания','город регистрации','место проживания','населенный пункт','местоположение','локация','city','location']);
const workplaceLabels = new Set(['место работы','место работы кандидата','текущее место работы','последнее место работы','организация','компания','работодатель','workplace','employer','company']);
function extraValue(contact,labels) {
  return asText(contact.extra?.find(([label,value]) => labels.has(clean(label)) && asText(value))?.[1]);
}
function candidateAge(contact,now=new Date()) {
  const extras = contact.extra ?? [];
  const birthdays = [contact.birthDate,...extras.filter(([label]) => birthLabels.has(clean(label))).map(([,value])=>value)];
  for(const value of birthdays) {
    const raw = asText(value);
    const birthday = responseDate(/^\d{5}$/.test(raw) ? sheetDate(Number(raw),false) : raw);
    if(!birthday || birthday > now) continue;
    const birthdayThisYear = new Date(now.getFullYear(),birthday.getMonth(),birthday.getDate());
    if(birthday.getMonth() === 1 && birthday.getDate() === 29 && birthdayThisYear.getMonth() !== 1) birthdayThisYear.setDate(0);
    const years = now.getFullYear() - birthday.getFullYear() - (now < birthdayThisYear ? 1 : 0);
    if(years <= 120) return years;
  }
  const ages = [contact.age,...extras.filter(([label]) => ageLabels.has(clean(label))).map(([,value])=>value)];
  for(const raw of ages) {
    const years = /^(\d{1,3})(?:\s*(?:год|года|лет))?$/i.exec(asText(raw))?.[1];
    if(years && Number(years) <= 120) return Number(years);
  }
  return null;
}
function candidateCity(contact) {
  return asText(contact.city) || extraValue(contact,cityLabels);
}
function candidateWorkplace(contact) {
  return asText(contact.workplace) || extraValue(contact,workplaceLabels);
}
function responseSignature(contact) {
  if(contact.sourceId) return 'id:' + clean(contact.sourceId);
  const date = responseDate(contact.date);
  return JSON.stringify([date ? date.valueOf() : clean(contact.date),clean(contact.adId || contact.job)]);
}
function decodeText(bytes) {
  if(bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
  if(bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
  if(bytes[1] === 0 && bytes[3] === 0) return new TextDecoder('utf-16le').decode(bytes);
  try { return new TextDecoder('utf-8', {fatal:true}).decode(bytes); }
  catch { return new TextDecoder('windows-1251').decode(bytes); }
}
function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  function pushRow() {
    row.push(value);
    if(row.some(cell => cell.trim())) rows.push(row);
    row = [];
    value = '';
  }
  for(let i = 0; i < text.length; i++) {
    const character = text[i];
    if(quoted) {
      if(character !== '"') value += character;
      else if(text[i + 1] === '"') { value += '"'; i++; }
      else quoted = false;
      continue;
    }
    if(character === '"' && !value.trim()) { value = ''; quoted = true; }
    else if(character === delimiter) { row.push(value); value = ''; }
    else if(character === '\r' || character === '\n') {
      if(character === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else value += character;
  }
  if(quoted) throw new Error('В CSV есть незакрытая кавычка.');
  if(row.length || value) pushRow();
  return rows;
}
function parseCSV(bytes) {
  let text = decodeText(bytes).replace(/^\uFEFF/, '');
  const explicit = text.match(/^sep=(.)\r?\n/i);
  if(explicit) return parseDelimited(text.slice(explicit[0].length), explicit[1]);
  const alternatives = [';', ',', '\t'].flatMap(delimiter => {
    try {
      const rows = parseDelimited(text, delimiter);
      const widths = rows.slice(0, 24).map(row => row.length);
      const score = widths.filter(width => width > 1).length * 100 + Math.max(0, ...widths);
      return [{rows, score}];
    } catch { return []; }
  }).sort((a,b) => b.score - a.score);
  if(!alternatives.length || !alternatives[0].score) throw new Error('В файле нет строк для импорта или его формат повреждён.');
  return alternatives[0].rows;
}

const spreadsheetNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
function xmlParse(contents) {
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(contents), 'application/xml');
  if(xml.querySelector('parsererror')) throw new Error('Повреждён лист Excel.');
  return xml;
}
const elements = (node, name) => [...node.getElementsByTagNameNS('*',name)];
function archiveReader(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let end = buffer.byteLength - 22;
  for(; end >= Math.max(0, buffer.byteLength - 65557); end--) {
    if(view.getUint32(end,true) === 0x06054b50 && end + 22 + view.getUint16(end + 20,true) === buffer.byteLength) break;
  }
  if(end < Math.max(0, buffer.byteLength - 65557)) throw new Error('Не удалось открыть архив XLSX.');
  const entries = new Map();
  let position = view.getUint32(end + 16,true);
  const count = view.getUint16(end + 10,true);
  for(let index = 0; index < count; index++) {
    if(position + 46 > bytes.length || view.getUint32(position,true) !== 0x02014b50) throw new Error('Повреждён архив XLSX.');
    const length = view.getUint16(position + 28,true);
    const start = position + 46;
    const name = new TextDecoder().decode(bytes.subarray(start,start + length));
    entries.set(name,{
      offset:view.getUint32(position + 42,true), method:view.getUint16(position + 10,true),
      packed:view.getUint32(position + 20,true), unpacked:view.getUint32(position + 24,true)
    });
    position = start + length + view.getUint16(position + 30,true) + view.getUint16(position + 32,true);
  }
  return {
    has:path => entries.has(path),
    async read(path) {
      const entry = entries.get(path);
      if(!entry || entry.offset + 30 > bytes.length || entry.unpacked > 48 * 1024 * 1024) throw new Error('Лист Excel отсутствует или слишком велик.');
      if(view.getUint32(entry.offset,true) !== 0x04034b50) throw new Error('Повреждён архив XLSX.');
      const start = entry.offset + 30 + view.getUint16(entry.offset + 26,true) + view.getUint16(entry.offset + 28,true);
      if(start + entry.packed > bytes.length) throw new Error('Повреждён архив XLSX.');
      const packed = bytes.subarray(start,start + entry.packed);
      if(entry.method === 0) return packed;
      if(entry.method !== 8) throw new Error('Этот способ сжатия XLSX не поддерживается.');
      if(typeof DecompressionStream !== 'function') throw new Error('Для XLSX нужен современный браузер. Также можно сохранить таблицу как CSV.');
      const reader = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const result = new Uint8Array(entry.unpacked);
      let size = 0;
      for(;;) {
        const {done,value} = await reader.read();
        if(done) break;
        if(size + value.length > result.length) { await reader.cancel(); throw new Error('Повреждён архив XLSX.'); }
        result.set(value,size);
        size += value.length;
      }
      if(size !== result.length) throw new Error('Повреждён архив XLSX.');
      return result;
    }
  };
}
function cellColumn(reference, fallback) {
  const letters = (reference ?? '').match(/^[A-Z]+/)?.[0];
  if(!letters) return fallback;
  return [...letters].reduce((column,letter) => column * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}
async function openXlsx(buffer) {
  const archive = archiveReader(buffer);
  const workbook = xmlParse(await archive.read('xl/workbook.xml'));
  const relationships = xmlParse(await archive.read('xl/_rels/workbook.xml.rels'));
  const paths = new Map(elements(relationships,'Relationship').map(node => [node.getAttribute('Id'),node.getAttribute('Target')]));
  const date1904 = ['true','1'].includes(elements(workbook,'workbookPr')[0]?.getAttribute('date1904'));
  const sheets = elements(workbook,'sheet').flatMap(sheet => {
    const target = paths.get(sheet.getAttributeNS(spreadsheetNS,'id') || sheet.getAttribute('r:id'));
    if(!target || !/(^|\/)worksheets\//.test(target)) return [];
    const path = new URL(target,'https://xlsx.invalid/xl/workbook.xml').pathname.slice(1);
    return [{name:sheet.getAttribute('name'), path}];
  });
  if(!sheets.length) throw new Error('В книге Excel нет листов с таблицами.');
  const strings = archive.has('xl/sharedStrings.xml')
    ? elements(xmlParse(await archive.read('xl/sharedStrings.xml')),'si').map(item => elements(item,'t').map(text => text.textContent).join(''))
    : [];
  return {
    sheets:sheets.map(sheet => sheet.name),
    date1904,
    async rowsAt(index) {
      const sheet = xmlParse(await archive.read(sheets[index].path));
      const data = elements(sheet,'sheetData')[0];
      if(!data) return [];
      return elements(data,'row').map(node => {
        const row = [];
        for(const cell of elements(node,'c')) {
          const type = cell.getAttribute('t');
          const value = elements(cell,'v')[0]?.textContent ?? '';
          const column = cellColumn(cell.getAttribute('r'),row.length);
          if(column >= 16384) throw new Error('Лист содержит недопустимый адрес ячейки.');
          if(type === 's') row[column] = strings[Number(value)] ?? '';
          else if(type === 'inlineStr') row[column] = elements(cell,'t').map(text => text.textContent).join('');
          else if((!type || type === 'n') && value && Number.isFinite(Number(value))) row[column] = Number(value);
          else row[column] = value;
        }
        return row;
      }).filter(row => row.some(cell => asText(cell)));
    }
  };
}
function suggestMapping(headers) {
  const normalized = headers.map(clean);
  const fallback = {
    name:/^(?:ф и о|фио|имя|фамилия имя|full name)(?: |$)/u,
    phone:/(?:^| )(?:телефон\p{L}*|phone|мобильный)(?: |$)/u,
    job:/(?:^| )(?:название вакансии|заголовок вакансии|название объявления)(?: |$)/u,
    date:/(?:дата|время) (?:и время )?(?:отклика|подачи отклика)/u,
    sourceId:/(?:id|номер|идентификатор) (?:отклика|заявки)(?: |$)/u,
    adId:/(?:id|номер|идентификатор) (?:объявления|вакансии)(?: |$)/u
  };
  const assigned = new Set();
  return Object.fromEntries(fields.map(field => {
    const aliases = new Set(field.aliases.map(clean));
    let column = normalized.findIndex((label,index) => !assigned.has(index) && aliases.has(label));
    if(column < 0 && fallback[field.id]) column = normalized.findIndex((label,index) => !assigned.has(index) && fallback[field.id].test(label));
    if(column >= 0) assigned.add(column);
    return [field.id,column];
  }));
}
function guessHeader(rows) {
  let best = {index:0, score:-1};
  for(let index=0; index<Math.min(rows.length,25); index++) {
    const mapping = suggestMapping(Array.from(rows[index],asText));
    const score = Object.values(mapping).filter(column => column >= 0).length + (mapping.name >= 0 ? 3 : 0) + (mapping.phone >= 0 ? 3 : 0);
    if(score > best.score) best = {index,score};
  }
  return best.index;
}
function sheetDate(value,date1904) {
  if(typeof value !== 'number' || value < 1 || value > 2950000) return asText(value);
  const epoch = date1904 ? Date.UTC(1904,0,1) : Date.UTC(1899,11,value < 60 ? 31 : 30);
  const iso = new Date(epoch + Math.round(value * 86400000)).toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0,10) : iso.replace('T',' ').slice(0,16);
}
function contactsFromRows(rows, headers, mapping, defaultJob, date1904) {
  const used = new Set(Object.values(mapping));
  let skipped = 0;
  const contacts = [];
  for(const [index,row] of rows.entries()) {
    if(!row.some(cell => asText(cell))) continue;
    const read = key => asText(row[mapping[key]]);
    const name = read('name');
    const phone = read('phone').replace(/^'(?=\+?\d)/,'');
    if(!name && !phone) { skipped++; continue; }
    if(name && clean(name) === clean(headers[mapping.name]) && clean(phone) === clean(headers[mapping.phone])) { skipped++; continue; }
    contacts.push({
      name,phone,job:read('job') || asText(defaultJob),sourceId:read('sourceId'),adId:read('adId'),
      date:sheetDate(row[mapping.date],date1904),
      importRow:index+1,importCalled:wasCalledInFile(read('callStatus'),read('callAttempts')),
      extra:row.flatMap((value,index) => used.has(index) || !asText(value) ? [] : [[headers[index] || 'Колонка ' + (index + 1),asText(value)]])
    });
  }
  return {contacts,skipped};
}
const calledStatuses = new Set([
  'да','true','1','yes','обзвонен','обзвонено','обзвонили','позвонили','звонили','дозвонились','связались',
  'звонок состоялся','звонок выполнен','обработан','обработано','недозвон','не дозвонились','не ответил',
  'нет ответа','не берет трубку','перезвон','перезвонить','в работе','закрыт','закрыто','closed','called',
  ...[...stages.slice(1),archivedStage,callbackStage].map(stage=>clean(stage.name))
]);
function wasCalledInFile(status,attempts) {
  const normalized = clean(status);
  return calledStatuses.has(normalized) || /^ндз(?: \d+)?$/.test(normalized) || Number(asText(attempts).replace(',','.')) > 0;
}

const exportHeaders = ['ФИО','Телефон','Объявление','Дата отклика','Статус','Комментарий','Попытки дозвона','Перезвонить','Всего откликов','ID отклика','ID объявления','История действий','Другие поля','Дата первого отклика','Возраст лида (дней)'];
function exportRows(records) {
  return [exportHeaders,...records.map(contact => [
    contact.name,contact.phone,contact.job,contact.date,stageById[contact.status].name,contact.note,contact.attempts,
    contact.reminder ? exactDate.format(contact.reminder) : '',contact.responseKeys?.length ?? 1,contact.sourceId,contact.adId,
    contact.events.map(event => exactDate.format(event.at) + ' — ' + eventLabel(event)).join('\n'),
    contact.extra.map(([key,value]) => key + ': ' + value).join('\n'),
    firstResponse(contact) ? localDay(firstResponse(contact)) : '',leadAge(contact)?.days ?? ''
  ])];
}
function csvOutput(rows) {
  const cell = value => {
    let text = String(value ?? '');
    if(typeof value === 'string' && /^[\s\uFEFF]*[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"','""') + '"';
  };
  return '\uFEFF' + rows.map(row => row.map(cell).join(';')).join('\r\n');
}
const crcTable = Uint32Array.from({length:256},(_,index) => {
  let crc = index;
  for(let bit=0; bit<8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  return crc >>> 0;
});
const utf8 = new TextEncoder();
function storedZip(files) {
  const local = [];
  const central = [];
  let offset = 0;
  for(const [path,data] of files) {
    const name = utf8.encode(path);
    const bytes = utf8.encode(data);
    let crc = 0xffffffff;
    for(const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0,0x04034b50,true);
    lh.setUint16(4,20,true);
    lh.setUint16(12,33,true);
    lh.setUint32(14,crc,true);
    lh.setUint32(18,bytes.length,true);
    lh.setUint32(22,bytes.length,true);
    lh.setUint16(26,name.length,true);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0,0x02014b50,true);
    ch.setUint16(4,20,true);
    ch.setUint16(6,20,true);
    ch.setUint16(14,33,true);
    ch.setUint32(16,crc,true);
    ch.setUint32(20,bytes.length,true);
    ch.setUint32(24,bytes.length,true);
    ch.setUint16(28,name.length,true);
    ch.setUint32(42,offset,true);
    local.push(lh.buffer,name,bytes);
    central.push(ch.buffer,name);
    offset += 30 + name.length + bytes.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0,0x06054b50,true);
  end.setUint16(8,files.length,true);
  end.setUint16(10,files.length,true);
  end.setUint32(12,central.reduce((size,entry) => size + entry.byteLength,0),true);
  end.setUint32(16,offset,true);
  return new Blob([...local,...central,end.buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
}
const sheetNs = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationshipsNs = 'http://schemas.openxmlformats.org/package/2006/relationships';
function excelCell(value) {
  if(typeof value === 'number') return '<c><v>' + value + '</v></c>';
  const text = String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').slice(0,32767);
  return '<c t="inlineStr"><is><t xml:space="preserve">' + safe(text).replaceAll('&#39;','&apos;') + '</t></is></c>';
}
function xlsxOutput(rows) {
  const sheets = [];
  for(let start=1; start<rows.length || start===1; start+=1048575) {
    const number = sheets.length+1;
    const sheetRows = [rows[0],...rows.slice(start,start+1048575)];
    const xml = '<worksheet xmlns="' + sheetNs + '"><sheetData>' +
      sheetRows.map((row,index) => '<row r="' + (index+1) + '">' + row.map(excelCell).join('') + '</row>').join('') +
      '</sheetData></worksheet>';
    sheets.push({number,xml,path:'xl/worksheets/sheet' + number + '.xml'});
  }
  return storedZip([
    ['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      sheets.map(sheet => '<Override PartName="/' + sheet.path + '" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>'],
    ['_rels/.rels','<Relationships xmlns="' + relationshipsNs + '"><Relationship Id="rId1" Type="' + spreadsheetNS + '/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml','<workbook xmlns="' + sheetNs + '" xmlns:r="' + spreadsheetNS + '"><sheets>' +
      sheets.map(({number}) => '<sheet name="Отклики' + (number>1 ? ' ' + number : '') + '" sheetId="' + number + '" r:id="rId' + number + '"/>').join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels','<Relationships xmlns="' + relationshipsNs + '">' +
      sheets.map(({number}) => '<Relationship Id="rId' + number + '" Type="' + spreadsheetNS + '/worksheet" Target="worksheets/sheet' + number + '.xml"/>').join('') + '</Relationships>'],
    ...sheets.map(sheet => [sheet.path,sheet.xml])
  ]);
}
function downloadFile(file,filename) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1500);
}
function exportDialog() {
  showDialog('Экспорт откликов','Карточки, закреплённые за вами.',
    '<p class="dialog-copy">В таблице будут контакты, статусы, комментарии, напоминания и история действий.</p>',
    '<button class="button" id="export-csv">Скачать CSV</button><button class="button primary" id="export-xlsx">Скачать XLSX</button>');
  function download(format) {
    const rows = exportRows(state.contacts);
    const file = format === 'xlsx' ? xlsxOutput(rows) : new Blob([csvOutput(rows)],{type:'text/csv;charset=utf-8'});
    downloadFile(file,'zemlya-otkliki-' + localDay() + '.' + format);
  }
  $('#export-csv').onclick = () => download('csv');
  $('#export-xlsx').onclick = () => download('xlsx');
}

const icons = {
  logo:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  archive:'<rect x="3" y="4" width="18" height="4" rx="1"/><path d="M5 8v12h14V8m-10 5h6"/>',
  send:'<path d="m22 2-7 20-4-9-9-4 20-7ZM11 13l11-11"/>',
  pin:'<path d="M20 10c0 5-8 10-8 10S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19m0-14-1.5 1.5m-11 11L5 19"/>',
  moon:'<path d="M20.3 15.5A8.8 8.8 0 0 1 8.5 3.7 8.9 8.9 0 1 0 20.3 15.5Z"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  logout:'<path d="M10 17l5-5-5-5m5 5H3m9-8h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7"/>',
  note:'<path d="M4 4h16v12l-4 4H4V4Zm12 16v-4h4M8 9h8m-8 4h5"/>',
  left:'<path d="m14 6-6 6 6 6"/>',
  right:'<path d="m10 6 6 6-6 6"/>',
  board:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16"/>',
  list:'<path d="M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1"/>',
  history:'<path d="M3 12a9 9 0 1 1 2.6 6.4M3 8v4h4m5-5v5l3 2"/>',
  download:'<path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5"/>',
  upload:'<path d="M12 15V3m-4 4 4-4 4 4M5 14v6h14v-6"/>',
  user:'<circle cx="12" cy="8" r="3"/><path d="M5 20a7 7 0 0 1 14 0"/>',
  briefcase:'<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V4h8v3M3 12h18"/>',
  spark:'<path d="M12 2c0 6 4 10 10 10-6 0-10 4-10 10 0-6-4-10-10-10 6 0 10-4 10-10Z"/>',
  search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  filter:'<path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',
  phone:'<path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-5-2-2 2a13 13 0 0 1-7-7l2-2-2-5Z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  chat:'<path d="M20 5H4v12h5l3 3v-3h8V5Z"/><path d="M8 9h8m-8 4h6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  copy:'<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 4H4v12"/>'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + icons[name] + '</svg>';
const $ = selector => document.querySelector(selector);
const all = selector => [...document.querySelectorAll(selector)];
const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const uid = () => globalThis.crypto?.randomUUID?.() ?? (Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
const formatter = new Intl.NumberFormat('ru-RU');
const plurals = new Intl.PluralRules('ru-RU');
const formatCount = number => formatter.format(number);
const ageLabel = years => formatCount(years) + ' ' + ({one:'год',few:'года'}[plurals.select(years)] || 'лет');
const dialog = $('#dialog');
const relativeDate = new Intl.DateTimeFormat('ru-RU',{day:'numeric',month:'short'});
const exactDate = new Intl.DateTimeFormat('ru-RU',{dateStyle:'medium',timeStyle:'short'});
const lifecycleDate = new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'medium'});
const titles = {board:'Воронка',list:'Мои лиды',archive:archivedStage.name,callback:callbackStage.name,history:'История импорта'};
const state = {
  account:null,members:[],revision:-1,contacts:[],imports:[],view:'board',drag:null,limits:{},
  query:'',vacancy:'',from:'',to:'',status:'',onlyDue:false,importSource:null,importJob:0,committing:false
};
let toastTimer;
let database;
let unsubscribe;
let generation = 0;
let refreshing;
let refreshAgain = false;
let refreshTimer;
let live = false;
let channelReady = false;
let redrawAfterDrag = false;
let ownChanges = 0;
let transfer = null;
const arrivals = new Set();
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; },4200);
}
function showDialog(title,description,body,footer='') {
  transfer = null;
  dialog.classList.remove('contact-screen','transfer-dialog');
  delete dialog.dataset.contactId;
  dialog.innerHTML = '<div class="dialog-header"><div><h2 id="dialog-title">' + safe(title) + '</h2>' +
    (description ? '<p>' + safe(description) + '</p>' : '') + '</div><button class="icon-button" data-close aria-label="Закрыть">' +
    icon('close') + '</button></div><div class="dialog-body">' + body + '</div>' +
    (footer ? '<div class="dialog-footer">' + footer + '</div>' : '');
  if(!dialog.open) dialog.showModal();
}
function report(error) {
  console.error(error);
  toast(error?.message || 'Не удалось сохранить изменения.');
}
function connectionStatus(message,connected=false) {
  live = connected;
  $('#sync-status').textContent = message;
  $('#sync-status').dataset.live = String(connected);
}
function decodeLead(row) {
  return hydrateContact({...row.data,id:row.id,assignee:row.assignee});
}
function dissolveCards(ids) {
  if(!ids.size || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const board = $('.board');
  if(!board) return;
  const viewport = board.getBoundingClientRect();
  for(const card of board.querySelectorAll('[data-card]')) {
    if(!ids.has(card.dataset.card)) continue;
    const bounds = card.getBoundingClientRect();
    if(bounds.right <= viewport.left || bounds.left >= viewport.right ||
       bounds.bottom <= 0 || bounds.top >= window.innerHeight) continue;
    const ghost = document.createElement('div');
    ghost.className = 'card-dissolve';
    ghost.ariaHidden = 'true';
    Object.assign(ghost.style,{top:bounds.top+'px',left:bounds.left+'px',width:bounds.width+'px',height:bounds.height+'px'});
    document.body.append(ghost);
    ghost.addEventListener('animationend',()=>ghost.remove(),{once:true});
    setTimeout(()=>ghost.remove(),300);
  }
}
function replaceContacts(contacts,animate=true) {
  const previous = new Set(state.contacts.map(contact=>contact.id));
  const ids = new Set(contacts.map(contact=>contact.id));
  const removed = new Set([...previous].filter(id=>!ids.has(id)));
  if(animate) {
    dissolveCards(removed);
    for(const id of ids) if(!previous.has(id)) arrivals.add(id);
  }
  for(const id of removed) {
    arrivals.delete(id);
  }
  state.contacts = contacts;
  if(removed.has(state.drag)) state.drag = null;
  if(state.drag) redrawAfterDrag = true;
  else { redrawAfterDrag = false; render(); }
  syncOpenContact();
  syncTransferDialog();
}
function applyWorkspace(data) {
  const animate = state.revision !== -1;
  state.revision = data.revision;
  state.imports = data.imports.sort((a,b)=>b.at-a.at);
  state.members = data.members;
  const contacts = data.contacts.filter(row=>row.assignee===state.account.id)
    .map(decodeLead).sort((a,b)=>b.updatedAt-a.updatedAt);
  replaceContacts(contacts,animate);
}
function committed() {
  refreshAgain = true;
  if(refreshing) return refreshing;
  const current = generation;
  refreshing = (async () => {
    while(refreshAgain && state.account && current === generation) {
      refreshAgain = false;
      const before = ownChanges;
      const data = await database.snapshot(state.account,state.revision).catch(error => {
        if(error.code === 'ZEMLYA_ACCESS') return {accessRevoked:true};
        throw error;
      });
      if(current !== generation) return;
      if(before !== ownChanges) { refreshAgain = true; continue; }
      if(data?.accessRevoked) {
        clearAccount('Доступ к CRM закрыт.');
        await database.signOut();
        return;
      }
      if(data) applyWorkspace(data);
      if(channelReady) connectionStatus('Синхронизация включена',true);
    }
  })().finally(() => { if(current === generation) refreshing = null; });
  return refreshing;
}
function scheduleRefresh(delay=120) {
  if(refreshTimer || !state.account) return;
  refreshTimer = setTimeout(async () => {
    refreshTimer = null;
    try { await committed(); }
    catch(error) {
      setSyncError(error);
      scheduleRefresh(2000);
    }
  },delay);
}
function setSyncError(error) {
  console.error(error);
  if(state.account) connectionStatus('Повторяем синхронизацию…');
}
async function refreshAfterWrite() {
  try { await committed(); }
  catch(error) {
    setSyncError(error);
    scheduleRefresh();
  }
}
function hydrateContact(contact) {
  return {
    ...contact, status:contact.status === 'working' ? 'talking' : contact.status,
    attempts:contact.attempts ?? 0, reminder:contact.reminder ?? null, events:contact.events ?? [],
    firstResponseDate:contact.firstResponseDate ?? previousResponseDate(contact),
    responseKeys:contact.responseKeys ?? [responseSignature(contact)]
  };
}
function planImport(records,{contacts,skipped=0,file,sheet='',restore=false,source='avito-file'}) {
  const result = {added:0,duplicates:0,called:0,updated:0,skipped};
  const entry = {id:uid(),at:Date.now(),file,sheet,restore,source};
  if(!restore) {
    const writes = contacts.map((incoming,position) => ({
      ...incoming,id:uid(),status:'new',note:'',attempts:0,reminder:null,source,firstResponseDate:incoming.date,
      updatedAt:entry.at - position,responseKeys:[responseSignature(incoming)],
      events:[{kind:'import',at:entry.at,job:incoming.job,importId:entry.id}]
    }));
    result.added = writes.length;
    return {writes,result,entry:{...entry,...result}};
  }

  const writes = [];
  const existing = new Map(records.map(contact => [contact.id,hydrateContact(contact)]));
  const identities = candidateIndex(existing.values());
  for(const incoming of contacts) {
    const current = existing.get(incoming.id) || identities.find(incoming,existing);
    const contact = current ? {...incoming,id:current.id} : incoming;
    if(current) result.updated++;
    else result.added++;
    writes.push(contact);
    existing.set(contact.id,contact);
    identities.add(contact);
  }
  return {writes,result,entry:{...entry,...result}};
}
function leadData(contact) {
  const {assignee,assignedLogin,...data} = contact;
  return data;
}
async function persistCandidates(batch) {
  for(let attempt=0;attempt<4;attempt++) {
    try {
      const fresh = await database.snapshot(state.account,-1,false);
      if(fresh.accessRevoked) throw new Error('Доступ к CRM закрыт.');
      const {writes,result,entry} = planImport(fresh.contacts.map(decodeLead),batch);
      const unique = [...new Map(writes.map(lead=>[lead.id,lead])).values()];
      const assignments = Object.fromEntries(unique.filter(lead=>Object.hasOwn(lead,'assignedLogin'))
        .map(lead=>[lead.id,lead.assignedLogin]));
      const saved = await database.importBatch(fresh.revision,unique.map(leadData),[...(batch.logs??[]),entry],assignments);
      const {duplicates,called,skipped,importId} = saved;
      result.added = Math.max(0,result.added-duplicates-called-skipped);
      return {...result,duplicates,called,skipped:result.skipped+skipped,importId};
    } catch(error) {
      if(error.code !== '40001' || attempt === 3) throw error;
    }
  }
}
const noAnswer = status => ['missed','missed2'].includes(status);
const callResult = status => noAnswer(status) || status === 'talking';
const callbackAllowed = status => callResult(status) || status === callbackStage.id;
const isOverdue = (contact,now=Date.now()) => callbackAllowed(contact.status) && Boolean(contact.reminder && contact.reminder <= now);
function patchContact(record,change) {
  const at = Date.now();
  const contact = hydrateContact(record);
  const status = change.status ?? contact.status;
  const reminder = callbackAllowed(status) ? (change.reminder === undefined ? contact.reminder : change.reminder) : null;
  const note = change.note ?? contact.note;
  const moved = status !== contact.status;
  const recordCall = change.kind === 'call' || (moved && callResult(status));
  const events = [];
  if(change.kind === 'dial') events.push({kind:'dial',at});
  else if(recordCall) events.push({kind:'call',at,status,note:change.note || ''});
  if(moved && status === archivedStage.id) events.push({kind:'archive',at});
  else if(moved && contact.status === archivedStage.id) events.push({kind:'restore',at,status});
  else if(moved && (!recordCall || !callResult(status))) events.push({kind:'status',at,status});
  if((change.kind === 'note' || note !== contact.note) && !recordCall) events.push({kind:'note',at,note});
  if(reminder !== contact.reminder) events.push({kind:'reminder',at,reminder});
  if(!events.length) return contact;
  const attempts = contact.attempts + (recordCall && noAnswer(status) ? 1 : 0);
  const history = contact.note && !contact.events.some(event => event.note === contact.note)
    ? [...contact.events,{kind:'note',at:contact.updatedAt,note:contact.note}] : contact.events;
  return {...contact,status,reminder,note,attempts,updatedAt:at,events:[...history,...events]};
}
async function updateRecord(id,change) {
  for(let attempt=0;attempt<4;attempt++) {
    const row = await database.getLead(id,state.account.id);
    const original = decodeLead(row);
    const updated = patchContact(original,change);
    if(updated.events.length === original.events.length) return original;
    for(const event of updated.events.slice(original.events.length)) event.actor ??= state.account.login;
    try {
      await database.saveLead(id,row.version,leadData(updated));
      await refreshAfterWrite();
      return updated;
    } catch(error) {
      if(error.code !== '40001' || attempt === 3) throw error;
    }
  }
}
function eventLabel(event) {
  switch(event.kind) {
    case 'import': return 'Отклик загружен' + (event.job ? ' · ' + event.job : '');
    case 'refresh': return 'Данные обновлены из выгрузки' + (event.job ? ' · ' + event.job : '');
    case 'assignment': return event.assignee ? 'Передан сотруднику: '+event.assignee : 'Ответственный снят';
    case 'dial': return 'Вызов по номеру';
    case 'call': return 'Звонок · ' + (event.status === 'new' ? 'Без смены статуса' : stageById[event.status]?.name || 'В процессе') + (event.note ? ' · ' + event.note : '');
    case 'status': return 'Статус изменён · ' + (stageById[event.status]?.name || 'В процессе');
    case 'note': return event.note ? 'Заметка · ' + event.note : 'Комментарий очищен';
    case 'archive': return 'Перенесён во вкладку «Отказ»';
    case 'import_removed': return 'Убран из воронки при очистке загрузки';
    case 'restore': return 'Возвращён в воронку' + (event.status ? ' · ' + (stageById[event.status]?.name || event.status) : '');
    case 'reminder': return event.reminder ? 'Перезвонить · ' + exactDate.format(event.reminder) : 'Напоминание снято';
    default: return 'Карточка обновлена';
  }
}
function dateTimeValue(value) {
  if(!value) return '';
  const date = new Date(value);
  return localDay(date) + 'T' + String(date.getHours()).padStart(2,'0') + ':' + String(date.getMinutes()).padStart(2,'0');
}
function candidateNameParts(contact) {
  const source = asText(contact.name);
  const words = source ? source.split(/\s+/u) : [];
  const nameField = aliases => contact.extra?.find(([label,value]) =>
    aliases.includes(clean(label)) && asText(value))?.[1];
  const first = nameField(['имя','имя кандидата','имя соискателя','имя откликнувшегося','first name']);
  const patronymic = nameField(['отчество','отчество кандидата','отчество соискателя','patronymic','middle name']);
  const surname = nameField(['фамилия','фамилия кандидата','фамилия соискателя','фамилия откликнувшегося','last name','surname']);
  const explicitPrimary = [first || (words.length === 1 ? source : ''),patronymic].filter(Boolean).join(' ');
  if(explicitPrimary && (first || patronymic || surname) && words.length <= 1) {
    return {primary:explicitPrimary,surname:asText(surname)};
  }
  if(first && patronymic && surname) return {primary:explicitPrimary,surname:asText(surname)};
  const nativeName = /^[\p{Script=Cyrillic}\p{M}.'’\-]+$/u;
  if(words.length < 2 || !words.every(word => nativeName.test(word))) {
    return {primary:source || 'Без имени',surname:''};
  }
  const patronymicEnding = /(?:ович|евич|ёвич|овна|евна|ёвна|ична|инична|ич)$/iu;
  const surnameRank = word => /(?:ова?|ева?|ёва?|ски[йе]|ская|цки[йе]|цкая|енко|чук|щук|швили|дзе|янц?|оглу)$/iu.test(word) ? 2 :
    Number(/(?:ина?|ына?|ко|ой)$/iu.test(word));
  const initial = /^(?:[А-ЯЁ]\.){1,2}$/iu;
  const particle = /^(?:оглы|улы|кызы|заде)$/iu;
  if(words.length >= 3 && (patronymicEnding.test(words[1]) || particle.test(words[2])) &&
    !(surnameRank(words[0]) && patronymicEnding.test(words[2]))) {
    const split = particle.test(words[2]) ? 3 : 2;
    return {primary:words.slice(0,split).join(' '),surname:words.slice(split).join(' ')};
  }
  if((words.length >= 3 && (patronymicEnding.test(words[2]) || (initial.test(words[1]) && initial.test(words[2])))) ||
    (words.length >= 4 && particle.test(words.at(-1))) ||
    (surnameRank(words[0]) > surnameRank(words[1]) && !patronymicEnding.test(words[1])) ||
    (initial.test(words[1]) && !initial.test(words[0]))) {
    return {primary:words.slice(1).join(' '),surname:words[0]};
  }
  if(words.length === 2 && surnameRank(words[1]) > surnameRank(words[0]) && !patronymicEnding.test(words[1])) {
    return {primary:words[0],surname:words[1]};
  }
  return {primary:source,surname:''};
}
function labelOf(contact) {
  const {primary,surname} = candidateNameParts(contact);
  return [primary,surname].filter(Boolean).join(' ');
}
const jobOf = contact => contact.job || 'Вакансия не указана';
const dateOf = (contact,short=false) => {
  if(!contact.date) return '—';
  const parsed = responseDate(contact.date);
  return parsed && short ? relativeDate.format(parsed).replace('.','') : contact.date;
};
function phoneHTML(contact) {
  if(!contact.phone) return '<span class="subtle">Без телефона</span>';
  const label = '+' + phoneKey(contact.phone);
  const formatted = safe(formatPhone(contact.phone));
  if(label.length < 8) return '<span class="phone">' + icon('phone') + formatted + '</span>';
  return '<a class="phone" title="Позвонить" data-phone="' + safe(contact.id) + '" href="tel:' + safe(label) + '">' + icon('phone') + formatted + '</a>';
}
function candidateName(contact) {
  const {primary,surname} = candidateNameParts(contact);
  const label = safe([primary,surname].filter(Boolean).join(' '));
  return '<button class="candidate-name" data-contact="' + safe(contact.id) + '" aria-label="' + label + '" title="' + label + '">' +
    '<span class="candidate-name-primary">' + safe(primary) + '</span>' +
    (surname ? ' <span class="candidate-name-surname">' + safe(surname) + '</span>' : '') + '</button>';
}
function callbackHTML(contact) {
  if(!callbackAllowed(contact.status) || !contact.reminder) return '';
  return '<span class="callback" data-time="' + contact.reminder + '">' + icon('clock') + '<span>' +
    (isOverdue(contact) ? 'Просрочено · ' : 'Перезвонить · ') + safe(exactDate.format(contact.reminder)) + '</span></span>';
}
function candidateLocationAge(contact) {
  const city = candidateCity(contact);
  const years = candidateAge(contact);
  return '<span class="card-meta"><span class="card-city">' + icon('pin') + '<span>' + safe(city || 'Город не указан') +
    '</span></span><span class="card-age">' + (years === null ? 'Возраст не указан' : safe(ageLabel(years))) + '</span></span>';
}
function candidateWork(contact) {
  const workplace = candidateWorkplace(contact);
  const vacancy = asText(contact.job);
  const label = workplace || !vacancy ? 'Место работы' : 'Вакансия';
  return '<span class="card-work"><span>' + label + '</span><strong>' + safe(workplace || vacancy || 'Не указано') + '</strong></span>';
}
function leadAgeHTML(contact,now=new Date()) {
  const age = leadAge(contact,now);
  if(!age) return '—';
  return '<span class="lead-age" title="' + (age.response ? 'Возраст лида с первого отклика' : 'Возраст лида с загрузки в CRM') + '">' +
    (age.days === 0 ? 'Сегодня' : formatCount(age.days) + ' дн.') + '</span>';
}
function archiveAction(contact) {
  const declined = contact.status === archivedStage.id;
  return '<button type="button" class="quick quick-archive archive-tone" data-archive="' + (declined ? 'restore' : 'move') +
    '" data-for="' + safe(contact.id) + '">' + (declined ? 'Вернуть в лиды' : 'Отказ') + '</button>';
}
function quickButton(contact,stage,label=stage.name) {
  return '<button type="button" class="quick ' + stage.color + '" data-quick="' + stage.id + '" data-for="' + safe(contact.id) + '">' + label + '</button>';
}
function quickActions(contact,compact=false) {
  const calls = [stageById.missed,stageById.missed2].map(stage => quickButton(contact,stage)).join('');
  const other = compact ? archiveAction(contact) + (contact.status === callbackStage.id
    ? quickButton(contact,stageById.new,'Вернуть в лиды') : quickButton(contact,callbackStage))
    : quickButton(contact,stageById.talking);
  return '<div class="quick-actions' + (compact ? ' card-quick-actions' : '') + '" role="group" aria-label="Быстрые действия">' +
    calls + other + '</div>';
}
function lifecycleHTML(contact) {
  const events = contact.events.filter(event => validTime(event.at));
  const appeared = events.find(event=>event.kind === 'import');
  const transferred = events.findLast(event=>event.kind === 'assignment' && event.assignee);
  const closed = contact.status === archivedStage.id
    ? events.findLast(event=>event.kind === 'archive')
    : contact.status === 'won' ? events.findLast(event=>event.status === 'won') : null;
  return '<dl class="lead-lifecycle">' + [
    ['Появился',appeared], ['Передан',transferred,transferred?.assignee], ['Закрыт',closed]
  ].map(([label,event,person]) => '<div><dt>' + label + '</dt><dd>' + (event
    ? '<time datetime="' + new Date(event.at).toISOString() + '">' + safe(lifecycleDate.format(event.at)) + '</time>' +
      (person ? '<span>' + safe(person) + '</span>' : '')
    : '—') + '</dd></div>').join('') + '</dl>';
}
function card(contact,stage) {
  const latest = contact.events.findLast(event => event.kind !== 'repeat');
  const summary = asText(contact.note) || (latest ? eventLabel(latest) : '');
  return '<article draggable="' + (stage.id !== callbackStage.id) + '" class="candidate' + (isOverdue(contact) ? ' overdue' : '') +
    (arrivals.delete(contact.id) ? ' entering' : '') + '" data-card="' + safe(contact.id) +
    '"><div class="card-top">' + candidateName(contact) + '</div>'+
    '<div class="card-phone">'+phoneHTML(contact)+'</div>'+candidateWork(contact)+candidateLocationAge(contact)+
    '<div class="card-bottom"><span class="tag '+stage.color+'">'+stage.name+'</span></div>'+lifecycleHTML(contact)+
    callbackHTML(contact)+
    (summary ? '<p class="card-summary" title="'+safe(summary)+'">'+icon(latest && !asText(contact.note) ? 'history' : 'note')+
      '<span>'+safe(summary)+'</span></p>' : '')+
    (stage.id === 'new' || stage.id === callbackStage.id ? quickActions(contact,true) : '')+'</article>';
}
function showNext(id,length) {
  const limit = state.limits[id] ?? (id === 'list' ? 50 : 35);
  return length > limit ? '<button class="button" data-more="' + id + '">Ещё ' + formatCount(Math.min(length - limit,50)) + '</button>' : '';
}
function renderHistory() {
  const history = state.imports;
  $('#history').innerHTML = history.length ? '<div class="panel"><table class="table"><thead><tr><th>Файл</th><th>Дата загрузки</th><th>Добавлено</th><th>Повторы</th><th>Обзвоненные</th><th>Пропущено</th><th scope="col">Действия</th></tr></thead><tbody>' +
    history.map(item => '<tr><td><strong>' + safe(item.file) + '</strong>' +
      (item.sheet ? '<div class="subtle">' + safe(item.sheet) + '</div>' : '') +
      '</td><td>' + exactDate.format(item.at) + '</td><td>' + item.added +
      '</td><td>' + item.duplicates + (item.updated ? ' · обновлено ' + item.updated : '') + '</td><td>' + (item.called ?? '—') + '</td><td>' + item.skipped +
      '</td><td><div class="row-actions">' +
      (item.hasReport ? '<button type="button" class="button" data-import-report="' + safe(item.id) + '">Повторы и обзвоненные</button>' : '') +
      (isOwner() && item.added && !item.restore && (item.source ?? 'avito-file') === 'avito-file'
        ? '<button type="button" class="button" data-clean-import="' + safe(item.id) + '">Убрать из воронки</button>' +
          '<button type="button" class="button" data-removed-import="' + safe(item.id) + '">Убранные</button>' : '') +
      '</div></td></tr>').join('') +
    '</tbody></table></div>' : '<div class="empty-panel panel">Здесь появятся результаты загрузки файлов.</div>';
  $('#history').onclick = event => {
    const button = event.target.closest('[data-clean-import],[data-removed-import],[data-import-report]');
    if(!button) return;
    const {cleanImport,removedImport,importReport} = button.dataset;
    const log = history.find(item=>item.id === (cleanImport ?? removedImport ?? importReport));
    if(!log) return;
    if(cleanImport) openImportCleanup(log);
    if(removedImport) openRemovedImport(log);
    if(importReport) openImportReport(log.id,log.file);
  };
}
async function openImportReport(id,file) {
  showDialog('Пропущенные записи',file,'<p class="loading">Загружаем отчёт…</p>','<button class="button" data-close>Закрыть</button>');
  const body = $('.dialog-body');
  try {
    const rows = await database.importReport(id);
    if(!dialog.open || !body.isConnected) return;
    body.innerHTML = rows.length
      ? '<div class="sample import-report"><table><thead><tr><th>Запись</th><th>ФИО</th><th>Телефон или ID</th><th>Причина</th></tr></thead><tbody>' +
        rows.map(row=>'<tr><td>' + safe(row.row) + '</td><td>' + safe(row.name || 'Без имени') + '</td><td>' +
          safe(formatPhone(row.phone) || row.sourceId || '—') + '</td><td>' +
          (row.reason === 'called' ? 'Уже обзвонен' : 'Повтор') + '</td></tr>').join('') + '</tbody></table></div>'
      : '<p class="dialog-copy">Для этой загрузки нет сохранённого списка пропущенных записей.</p>';
  } catch(error) {
    if(body.isConnected) body.innerHTML = '<p class="notice error" role="alert">' + safe(error.message) + '</p>';
  }
}
function leadsFromImport(log,status) {
  return state.contacts.filter(contact => {
    const first = contact.events[0];
    return contact.status === status && first?.kind === 'import' && first.at === log.at &&
      (first.importId ?? log.id) === log.id;
  });
}
function openRemovedImport(log) {
  const contacts = leadsFromImport(log,removedStage.id);
  showDialog('Убранные из загрузки',log.file,
    contacts.length ? '<p class="dialog-copy">В воронку вернутся только карточки без звонков и найденных дублей.</p>' +
      '<div class="transfer-list" id="removed-import-list">' + contacts.map(contact=>'<div class="removed-import-row" data-removed-lead="' +
        safe(contact.id) + '"><strong>' + safe(labelOf(contact)) + '</strong><span>' +
        safe(formatPhone(contact.phone) || 'Без телефона') + '</span><small class="import-duplicate-label" hidden>Повтор</small></div>').join('') + '</div>'
      : '<p class="dialog-copy">В этой загрузке нет убранных карточек.</p>',
    '<button class="button" data-close>Закрыть</button>' + (contacts.length
      ? '<button class="button primary" id="restore-uncalled">Вернуть необзвоненных</button>' : ''));
  if(!contacts.length) return;
  const list = $('#removed-import-list');
  database.importDuplicates(log.id).then(ids => {
    if(!list.isConnected || !dialog.open) return;
    const duplicates = new Set(ids);
    for(const row of list.children) row.querySelector('small').hidden = !duplicates.has(row.dataset.removedLead);
  }).catch(error=>{ if(list.isConnected && dialog.open) report(error); });
  $('#restore-uncalled').onclick = async event => {
    const button = event.currentTarget;
    state.committing = button.disabled = true;
    try {
      const count = await database.restoreUncalledImport(log.id);
      await refreshAfterWrite();
      dialog.close();
      toast(count ? 'Возвращено в воронку: ' + formatCount(count) : 'Нет необзвоненных лидов без совпадений.');
    } catch(error) { report(error); }
    finally { state.committing = button.disabled = false; }
  };
}
function openImportCleanup(log) {
  if(!isOwner() || !log) return;
  const contacts = leadsFromImport(log,'new');
  const rows = contacts.map(contact => '<label class="transfer-row"><input type="checkbox" value="' + safe(contact.id) +
    '"><span class="transfer-person"><strong class="transfer-name">' + safe(labelOf(contact)) + '</strong><span class="transfer-phone">' +
    safe(formatPhone(contact.phone) || 'Без телефона') + '</span><small class="import-duplicate-label" hidden>Повтор</small></span><time>' + safe(dateOf(contact)) + '</time></label>').join('');
  showDialog('Убрать лидов загрузки', log.file + ' · ' + exactDate.format(log.at),
    rows ? '<p class="dialog-copy">Отмеченные карточки попадут в «Убранные» этой загрузки.</p>' +
      '<fieldset class="transfer-fields" id="cleanup-fields"><legend class="sr-only">Лиды загрузки</legend>' +
      '<div class="transfer-picks cleanup-tools"><button class="button" type="button" id="cleanup-duplicates">Отметить совпадения</button>' +
      '<button class="button" type="button" id="cleanup-all">Отметить всех</button></div>' +
      '<div class="transfer-list" id="cleanup-list">' + rows + '</div></fieldset>'
      : '<p class="dialog-copy">В колонке «Лид» нет твоих карточек из этой загрузки.</p>',
    '<button type="button" class="button" data-close>Закрыть</button>' +
    (rows ? '<button type="button" class="button primary" id="cleanup-submit" disabled>Убрать выбранных</button>' : ''));
  if(!rows) return;
  dialog.classList.add('transfer-dialog');
  const inputs = all('#cleanup-list input');
  const toggle = $('#cleanup-all');
  const duplicates = $('#cleanup-duplicates');
  const submit = $('#cleanup-submit');
  const selection = () => inputs.filter(input => input.checked);
  function updateSelection() {
    const count = selection().length;
    toggle.textContent = count === inputs.length ? 'Снять отметки' : 'Отметить всех';
    submit.disabled = !count;
    submit.textContent = count ? 'Убрать выбранных (' + formatCount(count) + ')' : 'Убрать выбранных';
  }
  updateSelection();
  $('#cleanup-list').onchange = updateSelection;
  toggle.onclick = () => {
    const mark = selection().length !== inputs.length;
    for(const input of inputs) input.checked = mark;
    updateSelection();
  };
  duplicates.onclick = async () => {
    duplicates.disabled = true;
    try {
      const ids = new Set(await database.importDuplicates(log.id));
      if(!duplicates.isConnected || !dialog.open) return;
      let count = 0;
      for(const input of inputs) {
        const duplicate = ids.has(input.value);
        input.closest('label').querySelector('.import-duplicate-label').hidden = !duplicate;
        if(duplicate) { input.checked = true; count++; }
      }
      updateSelection();
      toast(count ? 'Совпадений в загрузке: ' + formatCount(count) : 'Среди сохранённых карточек совпадений нет.');
    } catch(error) { report(error); }
    finally { duplicates.disabled = false; }
  };
  submit.onclick = async () => {
    const ids = selection().map(input => input.value);
    const fields = $('#cleanup-fields');
    state.committing = fields.disabled = submit.disabled = true;
    try {
      const count = await database.archiveImport(log.id,ids);
      await refreshAfterWrite();
      dialog.close();
      toast('Убрано из воронки: ' + formatCount(count));
    } catch(error) { report(error); }
    finally {
      state.committing = fields.disabled = false;
      updateSelection();
    }
  };
}
function viewContacts() {
  const separate = separateViews[state.view];
  return state.contacts.filter(contact => separate ? contact.status === separate.id
    : contact.status !== archivedStage.id && contact.status !== callbackStage.id && contact.status !== removedStage.id);
}
function filteredContacts(contacts) {
  const normalized = clean(state.query);
  const queryNumber = digits(state.query);
  return contacts.filter(contact => {
    if(state.vacancy && state.vacancy !== contact.job) return false;
    if(state.status && state.status !== contact.status) return false;
    if(state.onlyDue && !isOverdue(contact)) return false;
    if(state.from || state.to) {
      const parsed = responseDate(contact.date);
      if(!parsed) return false;
      const day = localDay(parsed);
      if((state.from && day < state.from) || (state.to && day > state.to)) return false;
    }
    return !normalized || clean(labelOf(contact) + ' ' + jobOf(contact)).includes(normalized) ||
      clean(asText(contact.name) + ' ' + jobOf(contact)).includes(normalized) ||
      (queryNumber && /^[+\d\s()-]+$/.test(state.query) &&
       (digits(contact.phone).includes(queryNumber) || phoneKey(contact.phone).includes(phoneKey(state.query))));
  });
}
function renderResults() {
  const archive = state.view === 'archive';
  const callbackView = state.view === 'callback';
  const contacts = viewContacts();
  const visible = filteredContacts(contacts);
  $('#clear-filters').hidden = !(state.query || state.vacancy || state.status || state.from || state.to || state.onlyDue);
  const listView = state.view !== 'board';
  $('#board-controls').hidden = listView;
  $('#board-toolbar').hidden = listView;
  $('.switcher').hidden = archive || callbackView;
  $('#status-control').hidden = archive || callbackView;
  $('#due-control').hidden = archive;
  if(callbackView) {
    $('#results').innerHTML = visible.length
      ? '<div class="callback-cards">' + visible.slice(0,state.limits.callback ?? 35).map(contact => card(contact,callbackStage)).join('') +
        '</div>' + showNext('callback',visible.length)
      : '<div class="empty-panel panel">' + (contacts.length ? 'Совпадений нет.' : 'Здесь появятся кандидаты, которым нужно перезвонить.') + '</div>';
    return;
  }
  if(listView) {
    $('#results').innerHTML = visible.length ? '<div class="panel"><table class="table lead-table"><thead><tr><th>Кандидат</th><th>Телефон</th><th>Работа</th><th>Статус</th><th>Дата отклика</th><th>Возраст лида</th><th>Действия</th></tr></thead><tbody>' +
      visible.slice(0,state.limits.list ?? 50).map(contact => '<tr' + (isOverdue(contact) ? ' class="overdue"' : '') + '><td>' + candidateName(contact) + candidateLocationAge(contact) + callbackHTML(contact) + '</td><td>' + phoneHTML(contact) + '</td><td>' +
        candidateWork(contact) + '</td><td><span class="tag ' + stageById[contact.status].color + '">' + stageById[contact.status].name +
        '</span></td><td>' + safe(dateOf(contact)) + '</td><td>' + leadAgeHTML(contact) + '</td><td><div class="row-actions">' +
        archiveAction(contact) + '</div></td></tr>').join('') + '</tbody></table></div>' + showNext('list',visible.length)
      : '<div class="empty-panel panel">' + (contacts.length ? 'Совпадений нет.' : archive ? 'Здесь появятся кандидаты, перенесённые в отказ.' : 'Список откликов пуст.') + '</div>';
    return;
  }
  const left = $('.board')?.scrollLeft ?? 0;
  $('#results').innerHTML = '<div class="board" tabindex="0" aria-label="Этапы воронки">' + stages.map(stage => {
    const selected = visible.filter(contact => contact.status === stage.id);
    return '<section class="column ' + stage.color + '" data-stage="' + stage.id + '"><header class="column-heading"><span class="column-dot"></span><h2>' +
      stage.name + '</h2><span class="count">' + formatCount(selected.length) + '</span></header><div class="cards">' +
      (selected.length ? selected.slice(0,state.limits[stage.id] ?? 35).map(contact => card(contact,stage)).join('') + showNext(stage.id,selected.length)
        : '<p class="column-empty">' + ((state.query || state.vacancy || state.status || state.from || state.to || state.onlyDue) ? 'Нет совпадений' : 'Пока пусто') + '</p>') +
      '</div></section>';
  }).join('') + '</div>';
  const board = $('.board');
  board.scrollLeft = left;
  board.onscroll = syncBoardControls;
  syncBoardControls();
}
function render() {
  const history = state.view === 'history';
  for(const button of all('button[data-view]')) {
    const active = button.dataset.view === state.view;
    button.classList.toggle('active',active);
    button.setAttribute('aria-pressed',String(active));
  }
  $('#crumb-current').textContent = titles[state.view];
  $('#page-title').textContent = state.view === 'board' ? 'Воронка кандидатов' : titles[state.view];
  const descriptions = {history:'Загруженные файлы и результаты обработки.',archive:'Кандидаты, перенесённые в отказ.',
    callback:'Кандидаты, которым нужно перезвонить.'};
  $('#page-description').textContent = descriptions[state.view] ?? 'Отклики с Авито и этапы работы с кандидатами.';
  const viewHeadings = {archive:'Отклонённые лиды',callback:'Кандидаты на перезвон'};
  $('#pipeline-title').textContent = viewHeadings[state.view] ?? 'Мои лиды';
  $('#pipeline').hidden = history;
  $('#history').hidden = !history;
  for(const [view,stage] of Object.entries(separateViews)) {
    const count = state.contacts.filter(contact => contact.status === stage.id).length;
    const badge = $('#' + view + '-count');
    badge.textContent = formatCount(count);
    badge.hidden = !count;
  }
  if(history) { renderHistory(); return; }
  const vacancies = [...new Set(viewContacts().map(contact => contact.job).filter(Boolean))].sort((a,b) => a.localeCompare(b,'ru'));
  if(!vacancies.includes(state.vacancy)) state.vacancy = '';
  $('#vacancies').innerHTML = '<option value="">Все вакансии</option>' +
    vacancies.map(job => '<option value="' + safe(job) + '">' + safe(job) + '</option>').join('');
  $('#vacancies').value = state.vacancy;
  renderResults();
}
function currentContact(id) {
  return (state.contacts).find(contact => contact.id === id);
}
function initialsOf(contact) {
  return (contact.name.match(/[\p{L}\p{N}]+/gu) || ['?']).slice(0,2).map(word => word[0].toUpperCase()).join('');
}
function timelineItems(contact) {
  const events = contact.events.filter(event => event.kind !== 'repeat');
  if(contact.note && !events.some(event => event.note === contact.note)) {
    events.push({kind:'note',at:contact.updatedAt,note:contact.note});
  }
  if(!events.length) return '<p class="feed-empty">Здесь появятся заметки и действия по анкете.</p>';
  const appearance = {
    assignment:['user','Передача'],note:['note','Заметка'],archive:['archive','Отказ'],import_removed:['archive','Убран из загрузки'],
    restore:['left','Возвращение в воронку'],dial:['phone','Звонок'],call:['phone','Звонок'],status:['board','Этап изменён'],
    reminder:['clock','Перезвон'],import:['download','Отклик загружен'],refresh:['download','Данные обновлены']
  };
  return '<ol class="timeline">' + events.reverse().map(event => {
    const [glyph,title] = appearance[event.kind] ?? ['history','Действие'];
    const description = event.kind === 'note' ? event.note : eventLabel(event);
    return '<li class="timeline-item"><span class="timeline-icon">' + icon(glyph) + '</span><div class="timeline-entry"><div class="timeline-meta">' +
      '<strong>' + title + '</strong><time datetime="' + new Date(event.at).toISOString() + '">' + safe((event.actor ? event.actor+' · ' : '')+lifecycleDate.format(event.at)) +
      '</time></div>' + (description ? '<p>' + safe(description) + '</p>' : '') + '</div></li>';
  }).join('') + '</ol>';
}
function syncContactFeed(id) {
  if(!dialog.open || dialog.dataset.contactId !== id) return;
  const contact = currentContact(id);
  if(contact) {
    $('#contact-feed').innerHTML = timelineItems(contact);
    $('#contact-lifecycle').innerHTML = lifecycleHTML(contact);
  }
}
function syncOpenContact(force=false) {
  if(!dialog.open || !dialog.dataset.contactId) return;
  const id = dialog.dataset.contactId;
  const contact = currentContact(id);
  if(!contact || contact.status === removedStage.id) {
    dialog.close();
    toast(contact ? 'Карточка убрана из воронки.' : 'Карточка больше недоступна.');
    return;
  }
  const status = $('#contact-status');
  const reminder = $('#contact-reminder');
  if(!status || !reminder) return;
  const previousStatus = status.dataset.saved;
  const previousReminder = reminder.dataset.saved;
  status.dataset.saved = contact.status;
  reminder.dataset.saved = dateTimeValue(contact.reminder);
  if(force || status.value === previousStatus) status.value = contact.status;
  if(force || reminder.value === previousReminder) reminder.value = reminder.dataset.saved;
  $('#reminder-field').hidden = !callbackAllowed(status.value);
  const stage = stageById[contact.status];
  const badge = $('#contact-stage-badge');
  badge.className = 'tag ' + stage.color;
  badge.textContent = stage.name;
  const attempts = $('#contact-attempts');
  attempts.hidden = !contact.attempts;
  attempts.textContent = 'Попыток дозвона: ' + contact.attempts;
  syncContactFeed(id);
}
function detailDialog(id) {
  const contact = currentContact(id);
  if(!contact) return;
  const stage = stageById[contact.status];
  const stageOptions = allStages.map(item => '<option value="' + item.id + '"' +
    (item.id === contact.status ? ' selected' : '') + '>' + item.name + '</option>').join('');
  const age = leadAge(contact);
  const facts = [['Вакансия',candidateWorkplace(contact) && contact.job],['Дата отклика',contact.date],
    ['Возраст лида',age && formatCount(age.days) + ' дн. · ' + (age.response ? 'с первого отклика' : 'с загрузки в CRM')],
    ['ID отклика',contact.sourceId],['ID объявления',contact.adId],
    ...(contact.extra ?? []).filter(([label]) => ![ageLabels,cityLabels,workplaceLabels].some(labels => labels.has(clean(label))))]
    .filter(([,value]) => value).map(([key,value]) => '<div><dt>' + safe(key) + '</dt><dd>' + safe(value) + '</dd></div>').join('');
  const contacts = '<div class="contact-identity"><span class="avatar contact-avatar ' + stage.color + '">' + safe(initialsOf(contact)) +
    '</span><div><h2 id="dialog-title">' + safe(labelOf(contact)) + '</h2>' + candidateWork(contact) + candidateLocationAge(contact) +
    '</div></div><div class="contact-badges"><span id="contact-stage-badge" class="tag ' + stage.color + '">' + stage.name + '</span>' +
    (isOwner() ? '<button class="button ghost" data-delete-lead="'+safe(id)+'">Удалить</button>' : '') + '</div>';
  dialog.classList.add('contact-screen');
  dialog.dataset.contactId = id;
  dialog.innerHTML = '<header class="contact-top"><button class="button contact-back" data-close autofocus>' + icon('left') +
    ' К откликам</button><span>Анкета кандидата</span><button class="icon-button" data-close aria-label="Закрыть анкету">' + icon('close') +
    '</button></header><div class="contact-wrap"><div class="contact-hero">' + contacts +
    '</div><div class="contact-grid"><aside class="contact-profile" aria-label="Данные анкеты"><section class="contact-panel"><h3>Контакты и данные</h3>' +
    '<div class="contact-phone">' + phoneHTML(contact) + (contact.phone ? '<button type="button" class="icon-button" id="copy-phone" aria-label="Копировать номер" title="Копировать номер">' +
    icon('copy') + '</button>' : '') + '</div>' + (facts ? '<dl class="contact-facts">' + facts + '</dl>' : '') +
    '</section><section class="contact-panel"><h3>История лида</h3><div id="contact-lifecycle">' + lifecycleHTML(contact) +
    '</div></section><form class="contact-panel" id="contact-stage-form"><h3>Этап воронки</h3><label class="field"><span class="sr-only">Этап</span><select id="contact-status">' +
    stageOptions + '</select></label><label class="field" id="reminder-field"' + (callbackAllowed(contact.status) ? '' : ' hidden') +
    '>Перезвонить<input type="datetime-local" id="contact-reminder" value="' + dateTimeValue(contact.reminder) + '"></label>' +
    '<p class="attempts" id="contact-attempts"' + (contact.attempts ? '' : ' hidden') + '>Попыток дозвона: ' + contact.attempts + '</p>' +
    '<div class="contact-actions"><button class="button primary" id="save-contact">Сохранить</button><button class="button" type="button" id="log-call">' +
    icon('phone') + ' Записать звонок</button>' + archiveAction(contact) + '</div>' + quickActions(contact) +
    '</form></aside><section class="contact-panel contact-activity"><h3>Лента кандидата</h3>' +
    '<form id="contact-note-form" class="note-composer"><label class="field">Новая заметка<textarea id="contact-note" required maxlength="3000" ' +
    'placeholder="Что важно запомнить по этому кандидату?"></textarea></label><div class="note-actions"><button class="button primary" id="save-note">' +
    icon('note') + ' Добавить заметку</button></div></form><div id="contact-feed" aria-live="polite">' + timelineItems(contact) +
    '</div></section></div></div>';
  if(!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  $('#contact-status').dataset.saved = contact.status;
  $('#contact-reminder').dataset.saved = dateTimeValue(contact.reminder);
  $('#contact-status').onchange = event => { $('#reminder-field').hidden = !callbackAllowed(event.target.value); };
  $('#copy-phone')?.addEventListener('click',async () => {
    const phone = formatPhone(contact.phone);
    try { await navigator.clipboard.writeText(phone); }
    catch {
      const input = document.createElement('textarea');
      input.value = phone;
      input.style.cssText = 'position:fixed;left:-1000px';
      dialog.append(input);
      input.select();
      const copied = document.execCommand('copy');
      input.remove();
      if(!copied) { toast('Выделите номер в карточке и скопируйте его.'); return; }
    }
    $('#copy-phone')?.focus();
    toast('Номер скопирован.');
  });
  $('#contact-note-form').onsubmit = async event => {
    event.preventDefault();
    const field = $('#contact-note');
    const button = $('#save-note');
    const note = field.value.trim();
    if(!note) { field.focus(); return; }
    button.disabled = true;
    try {
      await updateRecord(id,{kind:'note',note});
      if(dialog.dataset.contactId === id && field.isConnected) {
        if(field.value.trim() === note) field.value = '';
        syncContactFeed(id);
        field.focus();
      }
      toast('Заметка добавлена.');
    } catch(error) { report(error); }
    finally { button.disabled = false; }
  };
  async function save(kind) {
    const buttons = [$('#save-contact'),$('#log-call')];
    const original = currentContact(id);
    for(const button of buttons) button.disabled = true;
    const statusField = $('#contact-status');
    const reminderField = $('#contact-reminder');
    const status = statusField.value;
    const date = reminderField.value;
    const reminder = callbackAllowed(status) && date ? new Date(date).valueOf() : null;
    const change = {kind};
    if(status !== statusField.dataset.saved || kind === 'call') change.status = status;
    if(date !== reminderField.dataset.saved) change.reminder = reminder;
    try {
      const saved = await updateRecord(id,change);
      if((saved.status === archivedStage.id) !== (original.status === archivedStage.id)) {
        if(dialog.dataset.contactId === id) dialog.close();
        toast(saved.status === archivedStage.id ? 'Кандидат перенесён во вкладку «Отказ».' : 'Кандидат возвращён в воронку.');
        return;
      }
      syncOpenContact(true);
      toast(kind === 'call' ? 'Звонок записан.' : 'Анкета сохранена.');
    } catch(error) { report(error); }
    finally { for(const button of buttons) button.disabled = false; }
  }
  $('#contact-stage-form').onsubmit = event => { event.preventDefault(); save('edit'); };
  $('#log-call').onclick = () => save('call');
}

function importDialog(error='') {
  state.importJob++;
  state.importSource = null;
  showDialog('Загрузить отклики','Загрузите файл, который скачали из Авито.',
    (error ? '<p class="notice error" role="alert">' + safe(error) + '</p>' : '') +
    '<div class="import-drop" id="import-drop"><span>' + icon('upload') + '</span><strong>Перетащите сюда файл</strong>' +
    '<p>Excel (.xlsx), CSV или TSV · до 20 МБ</p><button class="button primary" id="choose-file">Выбрать файл</button></div>',
    '<button class="button" data-close>Отмена</button>');
  $('#choose-file').onclick = () => $('#import-file').click();
  const drop = $('#import-drop');
  drop.ondragover = event => { event.preventDefault(); drop.classList.add('drop-target'); };
  drop.ondragleave = () => drop.classList.remove('drop-target');
  drop.ondrop = event => {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if(file) loadImport(file);
  };
}
async function loadImport(file) {
  const token = ++state.importJob;
  showDialog('Загрузить отклики',file.name,'<p class="loading">Читаем файл…</p>');
  try {
    if(file.size > 20 * 1024 * 1024) throw new Error('Файл больше 20 МБ. Разделите выгрузку на несколько файлов.');
    const ext = file.name.split('.').pop().toLowerCase();
    if(!['xlsx','csv','tsv'].includes(ext)) throw new Error('Поддерживаются XLSX, CSV и TSV. Для файла XLS сохраните копию в XLSX.');
    const bytes = await file.arrayBuffer();
    const csv = ext === 'xlsx' ? null : parseCSV(new Uint8Array(bytes));
    const source = csv ? {sheets:['Таблица'],date1904:false,rowsAt:async () => csv} : await openXlsx(bytes);
    if(token !== state.importJob || !dialog.open) return;
    state.importSource = {...source, name:file.name, sheet:0, header:0};
    await selectSheet(0);
  } catch(error) {
    if(token === state.importJob && dialog.open) importDialog(error.message || 'Не удалось прочитать файл.');
  }
}
async function selectSheet(index) {
  const source = state.importSource;
  const token = ++state.importJob;
  if(!source) return;
  showDialog('Загрузить отклики',source.name,'<p class="loading">Читаем лист…</p>');
  try {
    const rows = await source.rowsAt(index);
    if(token !== state.importJob || !dialog.open) return;
    source.rows = rows;
    source.sheet = index;
    source.header = guessHeader(rows);
    showMapping();
  } catch(error) {
    if(token === state.importJob && dialog.open) importDialog(error.message || 'Не удалось прочитать лист.');
  }
}
function showMapping() {
  const source = state.importSource;
  const {rows,header,sheets,sheet} = source;
  const columns = rows.slice(header).reduce((length,row) => Math.max(length,row.length),0);
  const headers = Array.from({length:columns},(_,index) => asText(rows[header]?.[index]));
  const mapping = suggestMapping(headers);
  const sheetField = sheets.length > 1 ? '<label class="field">Лист<select id="sheet-number">' +
    sheets.map((name,index) => '<option value="' + index + '"' + (sheet === index ? ' selected' : '') + '>' + safe(name) + '</option>').join('') +
    '</select></label>' : '';
  const headerField = rows.length > 1 ? '<label class="field">Строка с заголовками<select id="header-number">' +
    rows.slice(0,25).map((row,index) => '<option value="' + index + '"' + (header === index ? ' selected' : '') + '>' +
    (index+1) + ' · ' + safe(row.filter(value => asText(value)).slice(0,3).join(', ').slice(0,125)) + '</option>').join('') + '</select></label>' : '';
  const mappingFields = fields.map(field => '<label class="field">' + field.label +
    '<select data-field="' + field.id + '"><option value="-1">— Не выбрано —</option>' +
    headers.map((name,index) => '<option value="' + index + '"' + (mapping[field.id] === index ? ' selected' : '') + '>' +
      safe(name || 'Колонка ' + (index + 1)) + '</option>').join('') + '</select></label>').join('');
  const displayColumns = headers.slice(0,8);
  const sample = displayColumns.length ? '<p class="dialog-copy">Первые строки файла</p><div class="sample"><table><thead><tr>' +
    displayColumns.map((name,index) => '<th>' + safe(name || 'Колонка ' + (index + 1)) + '</th>').join('') +
    '</tr></thead><tbody>' + rows.slice(header + 1,header + 4).map(row => '<tr>' +
    displayColumns.map((_,index) => '<td>' + safe(asText(row[index]).slice(0,140)) + '</td>').join('') + '</tr>').join('') +
    '</tbody></table></div>' : '';
  showDialog('Проверка импорта',source.name,
    '<p class="dialog-copy">Выбери имя или телефон. Если в файле есть результаты звонков, сопоставь также статус обзвона или число попыток.</p>' +
    '<div class="fields">' + sheetField + headerField + mappingFields +
    '<label class="field full">Вакансия для строк без названия<input id="fallback-job" type="text" maxlength="250" placeholder="Например, курьер"></label></div>' +
    '<p class="notice" id="import-count" aria-live="polite"></p>' + sample,
    '<button class="button" id="change-file">Другой файл</button><button class="button primary" id="confirm-import">Загрузить отклики</button>');
  $('#change-file').onclick = () => importDialog();
  $('#sheet-number')?.addEventListener('change',event => selectSheet(Number(event.target.value)));
  $('#header-number')?.addEventListener('change',event => { source.header = Number(event.target.value); showMapping(); });
  function candidates() {
    const selected = Object.fromEntries(all('[data-field]').map(select => [select.dataset.field,Number(select.value)]));
    const selectedColumns = Object.values(selected).filter(index => index >= 0);
    if(selected.name < 0 && selected.phone < 0) return {error:'Выберите столбец с именем или телефоном.'};
    if(new Set(selectedColumns).size !== selectedColumns.length) return {error:'Выберите отдельный столбец для каждого поля.'};
    if(!isOwner()) return {error:'Импорт доступен администратору.'};
    return contactsFromRows(rows.slice(header + 1),headers,selected,$('#fallback-job').value,source.date1904);
  }
  function updateCount() {
    const next = candidates();
    const label = $('#import-count');
    if(next.error) label.textContent = next.error;
    else {
      const dialed = next.contacts.filter(contact=>contact.importCalled).length;
      label.textContent = 'Строк к проверке в базе: ' + formatCount(next.contacts.length) +
        (dialed ? ' · Отмечено обзвоненных в файле: ' + formatCount(dialed) : '') +
        (next.skipped ? ' · Пропущено: ' + formatCount(next.skipped) : '');
    }
    label.classList.toggle('error',Boolean(next.error));
    $('#confirm-import').disabled = Boolean(next.error || !next.contacts.length);
  }
  for(const select of all('[data-field]')) select.addEventListener('change',updateCount);
  $('#fallback-job').addEventListener('change',updateCount);
  updateCount();
  $('#confirm-import').onclick = async event => {
    const next = candidates();
    if(next.error || !next.contacts.length) return;
    const button = event.currentTarget;
    state.committing = true;
    button.disabled = true;
    $('#change-file').disabled = true;
    $('dialog [data-close]').disabled = true;
    for(const field of all('dialog :is(select,input)')) field.disabled = true;
    try {
      const result = await persistCandidates({...next,file:source.name,sheet:sheets.length > 1 ? sheets[sheet] : ''});
      state.view = 'board';
      await refreshAfterWrite();
      toast('Новых кандидатов: ' + formatCount(result.added) + ' · Совпадений: ' + formatCount(result.duplicates) +
        (result.called ? ' · Обзвоненных: ' + formatCount(result.called) : '') +
        (result.skipped ? ' · пропущено ' + formatCount(result.skipped) : ''));
      if(result.importId && (result.duplicates || result.called)) openImportReport(result.importId,source.name);
      else dialog.close();
    } catch(error) {
      report(error);
      showMapping();
    } finally { state.committing = false; }
  };
}

function downloadBackup() {
  const members = new Map(state.members.map(member=>[member.id,member.login]));
  const contacts = state.contacts.map(contact=>({...leadData(contact),assignedLogin:members.get(contact.assignee)??null}));
  const data = {format:'otklik-crm',version:1,createdAt:new Date().toISOString(),contacts,imports:state.imports};
  downloadFile(new Blob([JSON.stringify(data)],{type:'application/json'}),'zemlya-backup-' + localDay() + '.json');
}
function backupDialog() {
  showDialog('Резервная копия','Кандидаты, статусы, заметки и история импорта.',
    '<p class="dialog-copy">Копия включает закреплённые за вами карточки, их этапы, ответственных и историю действий.</p>' +
    '<p class="notice">Ваших откликов: ' + formatCount(state.contacts.length) + '.</p>',
    '<button class="button" id="restore-backup">Восстановить из копии</button><button class="button primary" id="download-backup">' +
      icon('download') + ' Скачать копию</button>');
  $('#download-backup').onclick = downloadBackup;
  $('#restore-backup').onclick = () => $('#backup-file').click();
}
const validTime = time => typeof time === 'number' && Number.isFinite(new Date(time).valueOf());
function readBackup(data) {
  if(data?.format !== 'otklik-crm' || data.version !== 1 || !Array.isArray(data.contacts) || !Array.isArray(data.imports)) {
    throw new Error('Выберите JSON-копию, скачанную из CRM «Земля».');
  }
  const contacts = data.contacts.map(contact => {
    if(!contact || typeof contact.id !== 'string' || !contact.id || typeof contact.name !== 'string' || typeof contact.phone !== 'string' ||
       typeof contact.status !== 'string' || (!Object.hasOwn(stageById,contact.status) && contact.status !== 'working') || !validTime(contact.updatedAt) ||
       !Array.isArray(contact.extra) || !contact.extra.every(item => Array.isArray(item) && item.length === 2 && item.every(value => typeof value === 'string'))) {
      throw new Error('В копии есть повреждённая карточка.');
    }
    const events = (contact.events ?? []);
    if(!Array.isArray(events) || !events.every(event => event && typeof event.kind === 'string' && validTime(event.at) &&
      (event.reminder == null || validTime(event.reminder)))) throw new Error('В копии повреждена история действий.');
    const attempts = contact.attempts ?? 0;
    const reminder = contact.reminder ?? null;
    if(!Number.isSafeInteger(attempts) || attempts < 0 || (reminder !== null && !validTime(reminder))) {
      throw new Error('В копии повреждены данные перезвона.');
    }
    const responseKeys = (contact.responseKeys ?? [responseSignature(contact)]);
    if(!Array.isArray(responseKeys) || !responseKeys.length || !responseKeys.every(value => typeof value === 'string')) {
      throw new Error('В копии повреждены данные об откликах.');
    }
    const {id,name,phone,status,updatedAt,extra,assignedLogin} = contact;
    const profile = Object.fromEntries(['age','birthDate','city','workplace'].filter(key => typeof contact[key] === 'string' ||
      (key === 'age' && typeof contact[key] === 'number')).map(key=>[key,contact[key]]));
    const assignment = assignedLogin === null || ['Казарян','Архипов','Стафеев'].includes(assignedLogin)
      ? {assignedLogin} : {};
    return {...assignment,...profile,id,name,phone,status:status === 'working' ? 'talking' : status,updatedAt,extra,attempts,reminder,events,responseKeys:[...new Set(responseKeys)],source:asText(contact.source),job:asText(contact.job),date:asText(contact.date),firstResponseDate:asText(contact.firstResponseDate) || previousResponseDate(contact),
      sourceId:asText(contact.sourceId),adId:asText(contact.adId),note:asText(contact.note)};
  });
  const logs = data.imports.map(log => {
    if(!log || typeof log.id !== 'string' || !validTime(log.at) ||
       ![log.added,log.duplicates,log.skipped,log.updated].every(value => Number.isSafeInteger(value) && value >= 0)) {
      throw new Error('В копии повреждена история импорта.');
    }
    const {id,at,added,duplicates,skipped,updated} = log;
    return {id,at,added,duplicates,skipped,updated,file:asText(log.file),sheet:asText(log.sheet),restore:Boolean(log.restore),
      ...(Number.isSafeInteger(log.called) && log.called >= 0 ? {called:log.called} : {}),
      ...(typeof log.source === 'string' ? {source:log.source} : {})};
  });
  return {contacts,logs};
}
async function restoreBackup(file) {
  try {
    const backup = readBackup(JSON.parse(await file.text()));
    showDialog('Восстановить данные?',file.name,
      '<p class="dialog-copy">В копии ' + formatCount(backup.contacts.length) + ' откликов. Для совпадающих карточек восстановятся этап, заметки, напоминания и история из копии. Если копия содержит ответственных, восстановятся и они. Остальные карточки останутся в базе.</p>',
      '<button class="button" data-close>Отмена</button><button class="button primary" id="confirm-restore">Восстановить</button>');
    $('#confirm-restore').onclick = async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await persistCandidates({...backup,file:file.name,restore:true});
        state.view = 'board';
        resetFilters();
        await refreshAfterWrite();
        dialog.close();
        toast('Добавлено ' + result.added + ' · обновлено ' + result.updated + ' · повторы ' + result.duplicates);
      } catch(error) { button.disabled = false; report(error); }
    };
  } catch(error) { toast(error instanceof SyntaxError ? 'Файл не содержит корректную JSON-копию.' : error.message); }
}

function resetFilters() {
  Object.assign(state,{query:'',vacancy:'',from:'',to:'',status:'',onlyDue:false,limits:{}});
  for(const id of ['search','vacancies','date-from','date-to','status-filter']) $('#' + id).value = '';
  $('#only-due').checked = false;
}
function syncBoardControls() {
  const board = $('.board');
  if(!board) return;
  $('#scroll-left').disabled = board.scrollLeft < 2;
  $('#scroll-right').disabled = board.scrollLeft + board.clientWidth + 2 >= board.scrollWidth;
}
function bindDrag() {
  const results = $('#results');
  results.addEventListener('dragstart',event => {
    const item = event.target.closest('[data-card]');
    if(!item) return;
    if(event.target.closest('a,button')) { event.preventDefault(); return; }
    state.drag = item.dataset.card;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain',state.drag);
    item.classList.add('dragging');
  });
  results.addEventListener('dragover',event => {
    const column = event.target.closest('[data-stage]');
    if(!column || !state.drag) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    column.classList.add('drop-target');
    const board = column.closest('.board');
    const bounds = board.getBoundingClientRect();
    if(event.clientX > bounds.right-58) board.scrollLeft += 24;
    else if(event.clientX < bounds.left+58) board.scrollLeft -= 24;
  });
  results.addEventListener('dragleave',event => {
    const column = event.target.closest('[data-stage]');
    if(column && (!(event.relatedTarget instanceof Node) || !column.contains(event.relatedTarget))) column.classList.remove('drop-target');
  });
  function clearDrag() {
    state.drag = null;
    for(const item of all('.dragging,.column.drop-target')) item.classList.remove('dragging','drop-target');
  }
  results.addEventListener('dragend',clearDrag);
  results.addEventListener('drop',async event => {
    const column = event.target.closest('[data-stage]');
    if(!column || !state.drag) return;
    event.preventDefault();
    const id = state.drag;
    const status = column.dataset.stage;
    clearDrag();
    const contact = (state.contacts).find(item => item.id === id);
    if(!contact || contact.status === status) return;
    try { await updateRecord(id,{status}); toast('Перенесено · ' + stageById[status].name); }
    catch(error) { report(error); }
  });
}
function bindEvents() {
  for(const item of all('[data-icon]')) item.innerHTML = icon(item.dataset.icon);
  for(const item of all('.sidebar button,.brand')) {
    item.title = item.textContent.trim();
    item.setAttribute('aria-label',item.textContent.trim());
  }
  document.addEventListener('click',event => {
    const target = event.target.closest('[data-view],[data-import],[data-contact],[data-close],[data-more],[data-quick],[data-archive],[data-phone],[data-card]');
    if(!target) return;
    if(target.hasAttribute('data-view')) {
      event.preventDefault();
      if(separateViews[state.view] !== separateViews[target.dataset.view]) resetFilters();
      state.view = target.dataset.view;
      render();
    } else if(target.hasAttribute('data-import')) importDialog();
    else if(target.hasAttribute('data-close')) { if(!state.committing) dialog.close(); }
    else if(target.hasAttribute('data-more')) {
      const id = target.dataset.more;
      state.limits[id] = (state.limits[id] ?? (id === 'list' ? 50 : 35)) + 50;
      renderResults();
      $('[data-more="' + id + '"]')?.focus();
    } else if(target.hasAttribute('data-quick')) {
      const status = target.dataset.quick;
      const loggedCall = callResult(status);
      target.disabled = true;
      updateRecord(target.dataset.for,{kind:loggedCall ? 'call' : 'edit',status}).then(() => {
        toast((loggedCall ? 'Звонок записан · ' : 'Перенесено · ') + stageById[status].name);
      },error => { target.disabled = false; report(error); });
    } else if(target.hasAttribute('data-archive')) {
      const id = target.dataset.for;
      const restore = target.dataset.archive === 'restore';
      target.disabled = true;
      updateRecord(id,{kind:'edit',status:restore ? 'new' : archivedStage.id}).then(() => {
        if(dialog.dataset.contactId === id) dialog.close();
        toast(restore ? 'Кандидат возвращён в «Лид».' : 'Кандидат перенесён во вкладку «Отказ».');
      },error => { target.disabled = false; report(error); });
    } else if(target.hasAttribute('data-phone')) {
      const id = target.dataset.phone;
      updateRecord(id,{kind:'dial'}).then(() => syncContactFeed(id),report);
    } else if(target.hasAttribute('data-contact')) detailDialog(target.dataset.contact);
    else if(!event.target.closest('a')) detailDialog(target.dataset.card);
  });
  dialog.addEventListener('cancel',event => { if(state.committing) event.preventDefault(); });
  dialog.addEventListener('close',() => {
    if(dialog.open) return;
    state.importJob++;
    delete dialog.dataset.contactId;
    transfer = null;
  });
  $('#search').addEventListener('input',event => { state.query = event.target.value; state.limits = {}; renderResults(); });
  $('#vacancies').addEventListener('change',event => { state.vacancy = event.target.value; state.limits = {}; renderResults(); });
  $('#backup').onclick = backupDialog;
  $('#export').onclick = exportDialog;
  $('#status-filter').innerHTML += stages.map(stage => '<option value="' + stage.id + '">' + stage.name + '</option>').join('');
  for(const [id,key] of [['date-from','from'],['date-to','to'],['status-filter','status'],['only-due','onlyDue']]) {
    $('#' + id).addEventListener('change',event => {
      state[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
      state.limits = {};
      renderResults();
      if(key === 'status' && state.status) {
        const board = $('.board');
        const column = board?.querySelector('[data-stage="' + state.status + '"]');
        if(column) board.scrollLeft += column.getBoundingClientRect().left - board.getBoundingClientRect().left;
      }
    });
  }
  $('#clear-filters').onclick = () => { resetFilters(); renderResults(); };
  let today = localDay();
  setInterval(() => {
    const now = Date.now();
    const todayNow = localDay();
    const dayChanged = todayNow !== today;
    today = todayNow;
    if(state.view === 'history' || state.drag) return;
    if(dayChanged) {
      renderResults();
      return;
    }
    if(state.onlyDue && !dialog.open && !$('#results').contains(document.activeElement)) {
      renderResults();
      return;
    }
    for(const label of all('#results .callback')) {
      if(Number(label.dataset.time) > now) continue;
      label.closest('.candidate,tr')?.classList.add('overdue');
      label.lastElementChild.textContent = 'Просрочено · ' + exactDate.format(Number(label.dataset.time));
    }
  },20000);
  $('#import-file').onchange = event => {
    const file = event.target.files[0];
    event.target.value = '';
    if(file) loadImport(file);
  };
  $('#backup-file').onchange = event => {
    const file = event.target.files[0];
    event.target.value = '';
    if(file) restoreBackup(file);
  };
  for(const [id,direction] of [['scroll-left',-1],['scroll-right',1]]) {
    $('#' + id).onclick = () => {
      const board = $('.board');
      if(board) board.scrollBy({left:direction * Math.max(220,board.clientWidth*.68),
        behavior:matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
    };
  }
  window.addEventListener('resize',syncBoardControls);
  bindDrag();
}
function isOwner() { return state.account?.role === 'owner'; }
function managePeople() {
  const members = state.members.map(member=>'<li><div><strong>'+safe(member.login)+'</strong><small>'+
    (member.role === 'owner' ? 'Администратор' : 'Сотрудник')+'</small></div><span>'+
    (member.active ? 'Доступ открыт' : 'Доступ закрыт')+'</span></li>').join('');
  showDialog('Сотрудники','Управление аккаунтами через Supabase Auth.',
    '<ul class="team-members">'+members+'</ul>');
}
function createLead() {
  showDialog('Новый лид','',
    '<form id="new-lead-form"><label class="field">ФИО<input name="name" maxlength="200" required></label>'
    + '<label class="field">Телефон<input name="phone" type="tel" maxlength="40"></label>'
    + '<div class="fields"><label class="field">Возраст<input name="age" type="number" min="0" max="120" step="1"></label>'
    + '<label class="field">Город<input name="city" maxlength="150"></label></div>'
    + '<label class="field">Место работы<input name="workplace" maxlength="200"></label>'
    + '<label class="field">Вакансия<input name="job" maxlength="200"></label>'
    + '<div class="dialog-footer"><button class="button" type="button" data-close>Отмена</button>'
    + '<button class="button primary" type="submit">Создать</button></div></form>');
  $('#new-lead-form').onsubmit = async event => {
    event.preventDefault();
    if(state.committing) return;
    const form = event.currentTarget;
    const submit = event.submitter;
    const fields = new FormData(form);
    const name = asText(fields.get('name'));
    if(!name) { toast('Укажи имя кандидата.'); return; }
    state.committing = true;
    if(submit) submit.disabled = true;
    try {
      const extra = [['Возраст',asText(fields.get('age'))],['Город',asText(fields.get('city'))],
        ['Место работы',asText(fields.get('workplace'))]].filter(([,value])=>value);
      const contact = {name,phone:asText(fields.get('phone')),job:asText(fields.get('job')),date:'',sourceId:'',adId:'',extra};
      const {added} = await persistCandidates({contacts:[contact],file:'Ручное добавление',source:'manual'});
      await refreshAfterWrite();
      if(form.isConnected && dialog.open) dialog.close();
      toast(added ? 'Лид добавлен.' : 'Лид с такими данными уже есть.');
    } catch(error) { report(error); }
    finally {
      state.committing = false;
      if(submit) submit.disabled = false;
    }
  };
}
function deleteLead(id) {
  const contact = currentContact(id);
  if(!isOwner() || !contact) return;
  showDialog('Удалить лида?',labelOf(contact),'<p class="dialog-copy">Карточка и её лента будут удалены из общей базы.</p>',
    '<button class="button" data-close>Отмена</button><button class="button primary" id="confirm-delete">Удалить</button>');
  $('#confirm-delete').onclick = async event => {
    const submit = event.currentTarget;
    submit.disabled = true;
    state.committing = true;
    try {
      await database.deleteLead(id);
      await refreshAfterWrite();
      if(submit.isConnected && dialog.open) dialog.close();
      toast('Лид удалён.');
    } catch(error) { report(error); }
    finally { state.committing = false; submit.disabled = false; }
  };
}
const maxTransferBatch = 5000;
const transferIncrements = [10,20,30];
function updateTransferControls() {
  const {ids,contacts} = transfer;
  const stage = stageById[$('#transfer-stage').value];
  const selected = contacts.filter(contact=>ids.has(contact.id)).length;
  const selectAll = $('#transfer-all');
  $('#transfer-bulk').hidden = !stage;
  if(stage) {
    const full = contacts.length > 0 && selected === contacts.length;
    selectAll.disabled = !contacts.length;
    selectAll.textContent = (full ? 'Снять выбор' : 'Выбрать всех') + ' · ' + stage.name;
    for(const button of all('[data-transfer-add]')) button.disabled = selected === contacts.length;
    $('#transfer-quantity').disabled = $('#transfer-set').disabled = !contacts.length;
    $('#transfer-stage-count').textContent = 'На этапе выбрано '+formatCount(selected)+' из '+formatCount(contacts.length);
  }
  $('#transfer-count').textContent = 'Всего выбрано '+formatCount(ids.size);
  $('#team-assign-submit').disabled = !ids.size || !$('#team-assignee').value;
}
function syncTransferDialog() {
  if(!transfer || !dialog.open || transfer.sending) return;
  const transferable = state.contacts.filter(contact=>contact.status !== removedStage.id);
  const available = new Set(transferable.map(contact=>contact.id));
  for(const id of transfer.ids) if(!available.has(id)) transfer.ids.delete(id);
  const recipient = $('#team-assignee');
  const chosen = recipient.value;
  const members = state.members.filter(member=>member.active && member.id !== state.account.id);
  recipient.innerHTML = '<option value="" disabled>'+ (members.length ? 'Выберите коллегу' : 'Нет получателей')+'</option>'+
    members.map(member=>'<option value="'+safe(member.id)+'">'+safe(member.login)+'</option>').join('');
  recipient.value = members.some(member=>member.id === chosen) ? chosen : '';
  recipient.disabled = !members.length;
  const stage = $('#transfer-stage').value;
  const contacts = transferable.filter(contact=>!stage || contact.status===stage);
  transfer.contacts = contacts;
  const list = $('#transfer-list');
  const focusId = list.contains(document.activeElement) ? document.activeElement.value : null;
  const scroll = list.scrollTop;
  list.innerHTML = contacts.map(contact => {
    const status = stageById[contact.status];
    const name = labelOf(contact);
    return '<label class="transfer-row"><input type="checkbox" name="transfer-lead" value="'+safe(contact.id)+
      '" aria-label="Выбрать: '+safe(name)+'"'+(transfer.ids.has(contact.id) ? ' checked' : '')+'>'+
      '<span class="transfer-person"><strong class="transfer-name">'+safe(name)+'</strong>'+
      '<span class="transfer-phone">'+safe(formatPhone(contact.phone) || 'Без телефона')+'</span>'+
      candidateWork(contact)+candidateLocationAge(contact)+'</span>'+
      '<span class="tag '+status.color+'">'+status.name+'</span></label>';
  }).join('') || '<p class="transfer-empty">'+(state.contacts.length ? 'На этом этапе кандидатов нет.' : 'У вас пока нет кандидатов.')+'</p>';
  if(focusId) {
    [...list.querySelectorAll('input')].find(input=>input.value === focusId)?.focus({preventScroll:true});
  }
  list.scrollTop = scroll;
  updateTransferControls();
}
function openTransferDialog() {
  const stagesHTML = allStages.map(stage=>'<option value="'+stage.id+'">'+stage.name+'</option>').join('');
  showDialog('Передать лиды','Выберите кандидатов и получателя.',
    '<fieldset class="transfer-fields" id="transfer-fields"><div class="transfer-filters">'+
    '<label class="field">Этап<select id="transfer-stage">'+stagesHTML+'<option value="">Все этапы</option></select></label>'+
    '<label class="field">Кому передать<select id="team-assignee"></select></label></div>'+
    '<div class="transfer-bulk" id="transfer-bulk"><div class="transfer-picks">'+
    '<button class="button" id="transfer-all" type="button" aria-controls="transfer-list"></button>'+
    transferIncrements.map(count=>'<button class="button" type="button" data-transfer-add="'+count+
      '" aria-label="Добавить '+count+' лидов" aria-controls="transfer-list">+'+count+'</button>').join('')+'</div>'+
    '<div class="transfer-exact"><label class="field">Точное количество<input id="transfer-quantity" type="number" '+
    'min="0" max="99" step="1" inputmode="numeric" placeholder="0–99" required></label>'+
    '<button class="button" id="transfer-set" type="button" aria-controls="transfer-list">Установить</button>'+
    '<span class="transfer-stage-count" id="transfer-stage-count"></span></div></div>'+
    '<div id="transfer-list" class="transfer-list" role="group" aria-label="Кандидаты"></div></fieldset>'+
    '<p class="notice error" id="transfer-error" role="alert" hidden></p>',
    '<span id="transfer-count" class="transfer-count" aria-live="polite"></span>'+
    '<button class="button" type="button" data-close>Отмена</button>'+
    '<button class="button primary" id="team-assign-submit" type="button" disabled>Передать</button>');
  dialog.classList.add('transfer-dialog');
  const current = {ids:new Set(),contacts:[],sending:false};
  transfer = current;
  const stage = $('#transfer-stage');
  const list = $('#transfer-list');
  const fieldset = $('#transfer-fields');
  const quantity = $('#transfer-quantity');
  stage.value = state.status || separateViews[state.view]?.id || 'new';
  stage.onchange = () => {
    quantity.value = '';
    list.scrollTop = 0;
    syncTransferDialog();
  };
  function syncSelection() {
    for(const input of list.querySelectorAll('input')) input.checked = current.ids.has(input.value);
    updateTransferControls();
  }
  $('#transfer-all').onclick = () => {
    const remove = current.contacts.every(contact=>current.ids.has(contact.id));
    for(const {id} of current.contacts) {
      if(remove) current.ids.delete(id);
      else current.ids.add(id);
    }
    syncSelection();
  };
  for(const button of all('[data-transfer-add]')) {
    button.onclick = () => {
      const available = current.contacts.filter(contact=>!current.ids.has(contact.id));
      for(const {id} of available.slice(0,Number(button.dataset.transferAdd))) current.ids.add(id);
      syncSelection();
    };
  }
  function setQuantity() {
    if(!quantity.reportValidity()) return;
    const selected = [];
    const available = [];
    for(const {id} of current.contacts) {
      if(current.ids.delete(id)) selected.push(id);
      else available.push(id);
    }
    for(const id of [...selected,...available].slice(0,quantity.valueAsNumber)) current.ids.add(id);
    syncSelection();
  }
  $('#transfer-set').onclick = setQuantity;
  quantity.onkeydown = event => {
    if(event.key === 'Enter') {
      event.preventDefault();
      setQuantity();
    }
  };
  $('#team-assignee').onchange = updateTransferControls;
  list.onchange = event => {
    const input = event.target;
    if(input.name !== 'transfer-lead') return;
    if(input.checked) current.ids.add(input.value);
    else current.ids.delete(input.value);
    updateTransferControls();
  };
  $('#team-assign-submit').onclick = async event => {
    const sender = state.account;
    const ids = [...current.ids];
    const recipient = $('#team-assignee').value;
    const button = event.currentTarget;
    const banner = $('#transfer-error');
    current.sending = state.committing = fieldset.disabled = button.disabled = true;
    button.textContent = 'Передаём…';
    banner.hidden = true;
    let changed = 0;
    try {
      for(let offset=0;offset<ids.length;offset+=maxTransferBatch) {
        const batch = ids.slice(offset,offset+maxTransferBatch);
        changed += await database.assign(batch,recipient);
        if(state.account !== sender) return;
        ownChanges++;
        const passed = new Set(batch);
        for(const id of passed) current.ids.delete(id);
        replaceContacts(state.contacts.filter(contact=>!passed.has(contact.id)));
        $('#transfer-count').textContent = 'Передано '+formatCount(changed)+' из '+formatCount(ids.length);
      }
      if(button.isConnected && dialog.open) dialog.close();
      toast('Передано карточек: '+formatCount(changed));
      await refreshAfterWrite();
    } catch(cause) {
      if(transfer !== current || !dialog.open) return;
      const message = cause?.message || 'Не удалось передать лидов.';
      banner.textContent = changed ? 'Передано '+formatCount(changed)+'. '+message : message;
      banner.hidden = false;
      scheduleRefresh();
    } finally {
      if(state.account === sender) state.committing = false;
      if(transfer === current && dialog.open) {
        current.sending = fieldset.disabled = false;
        button.textContent = 'Передать';
        syncTransferDialog();
      }
    }
  };
  syncTransferDialog();
}
function showAccount(message='') {
  $('.layout').hidden = !state.account;
  $('#team-account').hidden = Boolean(state.account);
  if(state.account) {
    all('[data-owner]').forEach(node=>{ node.hidden = !isOwner(); });
    $('#team-list-label').textContent = titles.list;
    $('#team-who').textContent = state.account.login;
    $('#team-role').textContent = isOwner() ? 'Администратор' : 'Сотрудник';
    return;
  }
  $('#auth-content').innerHTML = '<p class="team-auth-brand">'+icon('logo')+'Земля</p>'+
      '<h1 id="auth-title">Вход в CRM</h1><form id="team-account-form">'+
    '<label class="field">Логин<input name="login" autocomplete="username" placeholder="Фамилия" maxlength="40" required></label>'+
    '<label class="field">Пароль<input type="password" name="password" autocomplete="current-password" maxlength="128" required></label>'+
    '<p id="team-account-error" class="notice error" role="alert"'+(message ? '' : ' hidden')+'>'+safe(message)+'</p>'+
    '<button class="button primary" type="submit"'+(database ? '' : ' disabled')+'>Войти</button></form>';
  $('#team-account-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    const button = event.submitter;
    if(button) button.disabled = true;
    try {
      const account = await database.signIn(body.get('login'),body.get('password'));
      let data;
      try {
        data = await database.snapshot(account);
        if(data.accessRevoked) throw new Error('Доступ к CRM закрыт.');
      } catch(error) {
        await database.signOut().catch(console.error);
        throw error;
      }
      form.reset();
      state.account = account;
      state.view = 'board';
      resetFilters();
      showAccount();
      applyWorkspace(data);
      connectionStatus('Подключаем синхронизацию…');
      const current = generation;
      try {
        const stop = await database.watch(account,() => scheduleRefresh(),status => {
          if(current !== generation) return;
          channelReady = status === 'SUBSCRIBED';
          if(channelReady) {
            connectionStatus('Синхронизация включена',true);
            scheduleRefresh();
          } else {
            connectionStatus('Восстанавливаем соединение…');
            scheduleRefresh();
          }
        });
        if(current === generation) unsubscribe = stop;
        else await stop();
      } catch(error) {
        setSyncError(error);
        scheduleRefresh();
      }
    } catch(error) {
      const banner = $('#team-account-error');
      if(banner) { banner.hidden = false; banner.textContent = error.message; }
    } finally { if(button) button.disabled = false; }
  };
}
function clearAccount(message='') {
  generation++;
  clearTimeout(refreshTimer);
  refreshTimer = null;
  refreshing = null;
  refreshAgain = false;
  channelReady = false;
  live = false;
  unsubscribe?.();
  unsubscribe = null;
  state.account = null;
  state.revision = -1;
  state.contacts = [];
  state.imports = [];
  state.members = [];
  transfer = null;
  state.committing = false;
  arrivals.clear();
  state.drag = null;
  state.importSource = null;
  redrawAfterDrag = false;
  if(dialog.open) dialog.close();
  dialog.replaceChildren();
  $('#results').replaceChildren();
  $('#history').replaceChildren();
  showAccount(message);
}
async function signOut() {
  try { await database.signOut(); if(state.account) clearAccount(); }
  catch(error) { report(error); }
}
function bindTeam() {
  $('#team-people').onclick = managePeople;
  $('#new-lead').onclick = createLead;
  $('#team-assign').onclick = openTransferDialog;
  $('#mode').onclick = signOut;
  document.addEventListener('click',event => {
    const deletion = event.target.closest('[data-delete-lead]');
    if(deletion) deleteLead(deletion.dataset.deleteLead);
  });
  $('#results').addEventListener('dragend',() => {
    if(redrawAfterDrag) { redrawAfterDrag = false; render(); }
  });
  window.addEventListener('online',()=>scheduleRefresh());
  window.addEventListener('offline',()=>{ if(state.account) connectionStatus('Связь потеряна'); });
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) scheduleRefresh(); });
  setInterval(()=>{ if(!live && !document.hidden) scheduleRefresh(); },7000);
}
function start() {
  bindEvents();
  bindTeam();
  try {
    database = window.connectZemlya();
    database.onSignedOut(()=>{ if(state.account) clearAccount('Войди в CRM снова.'); });
    showAccount();
  } catch(error) { showAccount(error.message); }
}
start();


(() => {
  'use strict';

  function prepareGlobe(size, textureWidth, textureHeight) {
    const radius = size * .438;
    const center = (size - 1) / 2;
    const tilt = -.15;
    const viewLatitude = .165;
    const entries = [];
    for(let y=0;y<size;y++) {
      for(let x=0;x<size;x++) {
        const px = (x - center) / radius;
        const py = (center - y) / radius;
        const distance = Math.hypot(px,py);
        const alpha = Math.max(0,Math.min(1,(1-distance)*radius+.5));
        if(!alpha) continue;
        const pz = Math.sqrt(Math.max(0,1-px*px-py*py));
        const ax = px*Math.cos(tilt)-py*Math.sin(tilt);
        const ay = px*Math.sin(tilt)+py*Math.cos(tilt);
        const latitude = Math.asin(Math.min(1,Math.max(-1,ay*Math.cos(viewLatitude)+pz*Math.sin(viewLatitude))));
        const longitude = Math.atan2(ax,pz*Math.cos(viewLatitude)-ay*Math.sin(viewLatitude));
        const row = Math.min(textureHeight-1,Math.max(0,Math.round((.5-latitude/Math.PI)*(textureHeight-1))));
        const col = Math.floor((longitude/(2*Math.PI)+.47)*textureWidth);
        const direct = Math.max(0, -.47*px+.45*py+.75*pz);
        const daylight = .31 + .78*direct;
        const haze = (1-pz)**3 * (.44+.56*direct);
        entries.push((y*size+x)*4,row*textureWidth*4,col,daylight,haze,Math.round(255*alpha));
      }
    }
    return Float32Array.from(entries);
  }

  function paint(buffer,pixels,geometry,width,angle) {
    const shift = Math.floor(angle*width);
    const wrap = width-1;
    for(let i=0;i<geometry.length;i+=6) {
      const dest = geometry[i];
      const source = geometry[i+1]+((geometry[i+2]+shift)&wrap)*4;
      const daylight = geometry[i+3];
      const haze = geometry[i+4];
      buffer[dest] = pixels[source]*daylight+27*haze;
      buffer[dest+1] = pixels[source+1]*daylight+75*haze;
      buffer[dest+2] = pixels[source+2]*daylight+122*haze;
      buffer[dest+3] = geometry[i+5];
    }
  }

  async function start(figure) {
    const canvas = figure?.querySelector('.earth-live');
    const texture = figure?.querySelector('.earth-texture');
    if(!canvas || !texture || !canvas.getContext) return;
    try {
      await texture.decode();
      const textureCanvas = document.createElement('canvas');
      textureCanvas.width = 1024;
      textureCanvas.height = 512;
      const textureContext = textureCanvas.getContext('2d',{willReadFrequently:true});
      const context = canvas.getContext('2d');
      if(!textureContext || !context) return;
      textureContext.drawImage(texture,0,0,1024,512);
      const pixels = textureContext.getImageData(0,0,1024,512).data;
      const compact = matchMedia('(max-width: 650px)');
      const reduce = matchMedia('(prefers-reduced-motion: reduce)');
      let visible = !('IntersectionObserver' in window);
      const auth = figure.dataset.globe === 'auth';
      let geometry, frame, handle=0, last=0, age=auth ? 7800 : 0;

      const showFrame = () => {
        paint(frame.data,pixels,geometry,1024,(age/(auth ? 75000 : 40800))%1);
        context.putImageData(frame,0,0);
      };
      const resize = () => {
        canvas.width = canvas.height = auth ? (compact.matches ? 248 : 408) : (compact.matches ? 192 : 284);
        geometry = prepareGlobe(canvas.width,1024,512);
        frame = context.createImageData(canvas.width,canvas.height);
        showFrame();
      };
      const canPlay = () => visible && !document.hidden && !reduce.matches;
      function animate(time) {
        handle=0;
        if(!canPlay()) { last=0; return; }
        if(!last) last=time;
        if(time-last>=30) {
          age+=Math.min(time-last,100);
          last=time;
          showFrame();
        }
        handle=requestAnimationFrame(animate);
      }
      function schedule() {
        if(canPlay() && !handle) handle=requestAnimationFrame(animate);
        if(!canPlay() && handle) {
          cancelAnimationFrame(handle);
          last=handle=0;
        }
      }
      resize();
      figure.classList.add('is-live');
      if('IntersectionObserver' in window) {
        new IntersectionObserver(entries => {
          visible = entries[0].isIntersecting;
          schedule();
        }).observe(figure);
      }
      document.addEventListener('visibilitychange',schedule);
      compact.addEventListener('change',resize);
      reduce.addEventListener('change',schedule);
      schedule();
    } catch {
      // The embedded still remains available when the canvas cannot render.
    }
  }

  for(const figure of document.querySelectorAll('[data-globe]')) start(figure);
})();
