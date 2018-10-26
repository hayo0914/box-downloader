var client = require('./init').client;

const args = process.argv.slice(2);
const targetItemId = args[0]; // like 2861786671

if (targetItemId == null) {
  console.error('error');
  process.exit(1);
}

client.folders
  .getItems(targetItemId, {
    fields: 'name,type,modified_at,size',
    limit: 10000,
  })
  .then(items => {
    const itemsArr = [];
    for (let i of items.entries) {
      const { type, id, name, modified_at, size } = i;
      let size_m = size / 1024 / 1024;
      size_m = Math.ceil(size_m);
      let size_g = size / 1024 / 1024 / 1024;
      size_g = Math.ceil(size_g);
      itemsArr.push([type, id, name, modified_at, size, size_m, size_g]);
    }
    console.log('type,id,name,modified_at,size,size_m,size_g');
    itemsArr.forEach(i => {
      const row = i.map(el => '"' + el + '"').join(',');
      console.log(row);
    });
  });
