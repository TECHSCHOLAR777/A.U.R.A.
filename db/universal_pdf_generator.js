const fs = require('fs');
const { jsPDF } = require('jspdf');
require('jspdf-autotable');

/**
 * Helper function to map raw SQL row objects into a clean 2D array for the PDF.
 * Converts booleans to Yes/No automatically if applicable.
 * 
 * @param {Array<Object>} dbData - SQL result rows
 * @param {Object} config - Configuration object from REGISTER_CONFIGS
 * @returns {Array<Array<string>>} 2D Array for jsPDF autoTable
 */
function mapDataForPDF(dbData, config) {
    return dbData.map(row => {
        return config.dataKeys.map(key => {
            let val = row[key];
            
            // Handle null/undefined gracefully
            if (val === null || val === undefined) return '-';
            
            // Convert booleans / integer booleans to Yes/No for better ledger readability
            if (typeof val === 'boolean' || ((val === 1 || val === 0) && key.startsWith('referred'))) {
                return val ? 'Yes' : 'No';
            }
            
            return val.toString();
        });
    });
}

/**
 * Universal dynamic PDF generator for physical ICDS ledgers.
 * 
 * @param {Object} metaData - { state: string, centerName: string, workerName: string, month: string, year: string }
 * @param {Object} config - Configuration object from REGISTER_CONFIGS
 * @param {Array<Object>} dbData - SQL result rows
 */
function generateUniversalPDF(metaData, config, dbData) {
    if (!metaData || !config) throw new Error("metaData and config are required.");

    const tableBody = mapDataForPDF(dbData, config);
    
    // Dynamic Filename Generation
    // e.g., "Jharkhand_Register_No_6_10_2026.pdf"
    const safeState = metaData.state.replace(/\s+/g, '_');
    const safeTitle = config.title.split(':')[0].replace(/\s+/g, '_').replace(/\./g, ''); // Extracts "Register No 6"
    const fileName = `${safeState}_${safeTitle}_${metaData.month}_${metaData.year}.pdf`;

    // 1. Initialize Document
    const doc = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: 'a4'
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    
    // 2. Official Header
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(`GOVERNMENT OF ${metaData.state.toUpperCase()} - ICDS`, pageWidth / 2, 15, { align: 'center' });
    
    // 3. Dynamic Sub-Header (Register Title)
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(config.title, pageWidth / 2, 22, { align: 'center' });
    
    // 4. Metadata Details Row
    doc.setFontSize(10);
    doc.text(`AWC Name: ${metaData.centerName}`, 14, 30);
    doc.text(`AWW Name: ${metaData.workerName}`, pageWidth / 2, 30, { align: 'center' });
    doc.text(`Period: ${metaData.month} / ${metaData.year}`, pageWidth - 14, 30, { align: 'right' });

    // 5. Dynamic Table Generation
    doc.autoTable({
        startY: 35,
        head: [config.columns],
        body: tableBody,
        theme: 'grid', // Strict grid theme to mimic physical printouts
        headStyles: {
            fillColor: [255, 255, 255],
            textColor: [0, 0, 0],
            lineColor: [0, 0, 0],
            lineWidth: 0.1,
            fontStyle: 'bold',
            halign: 'center'
        },
        bodyStyles: {
            textColor: [0, 0, 0],
            lineColor: [0, 0, 0],
            lineWidth: 0.1,
            halign: 'center'
        },
        columnStyles: {
            0: { halign: 'left' }, // Left align the first descriptive column (usually Date or Name)
            1: { halign: 'left' }  // Left align the second column just in case (e.g. Name)
        },
        margin: { top: 35 }
    });

    // 6. Output to File
    fs.writeFileSync(fileName, Buffer.from(doc.output('arraybuffer')));
    console.log(`[PDF Engine] Generated dynamically: ${fileName}`);
}

module.exports = { mapDataForPDF, generateUniversalPDF };
