const fs = require('fs');

async function check() {
    const urlsText = fs.readFileSync('./urls.min.json', 'utf8');
    const w10meta = JSON.parse(fs.readFileSync('./w10_meta.json', 'utf8'));
    const w10preview = JSON.parse(fs.readFileSync('./w10_preview_meta.json', 'utf8'));
    
    const urls = JSON.parse(urlsText);
    const versions = [];
    
    for (const [v, urlsList] of Object.entries(urls.release)) {
        versions.push({version: v, is_preview: false, id: urlsList[0]});
    }
    for (const [v, urlsList] of Object.entries(urls.preview)) {
        versions.push({version: v, is_preview: true, id: urlsList[0]});
    }
    for (const v of Object.keys(w10meta)) {
        if (!versions.some(x => x.version === v && x.is_preview === false)) {
            versions.push({version: v, is_preview: false, id: 'UWP'});
        }
    }
    for (const v of Object.keys(w10preview)) {
        if (!versions.some(x => x.version === v && x.is_preview === true)) {
            versions.push({version: v, is_preview: true, id: 'UWP'});
        }
    }
    
    const mapped = versions.map(v => ({ id: v.version, stable: !v.is_preview }));
    const grouped = mapped.reduce((acc, curr) => {
        acc[curr.id] = (acc[curr.id] || 0) + 1;
        return acc;
    }, {});
    
    const duplicates = Object.entries(grouped).filter(([k,v]) => v > 1);
    console.log("Total versions:", versions.length);
    console.log("Duplicate versions:", duplicates.length);
    if (duplicates.length > 0) {
        console.log("Example duplicates:", duplicates.slice(0, 5));
        
        // Show what happens when showSnapshots is true vs false
        const filteredFalse = mapped.filter(x => x.stable).map(x => x.id);
        const uniqueFalse = new Set(filteredFalse);
        console.log("With showSnapshots=false: items:", filteredFalse.length, "unique:", uniqueFalse.size);
        
        const filteredTrue = mapped.map(x => x.id);
        const uniqueTrue = new Set(filteredTrue);
        console.log("With showSnapshots=true: items:", filteredTrue.length, "unique:", uniqueTrue.size);
    }
}
check();
