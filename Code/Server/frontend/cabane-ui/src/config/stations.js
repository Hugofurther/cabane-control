export const PANEL_LAYOUT = [
    // --- ROW 1 ---
    {
        id: 'row1',
        cols: 'grid-cols-1 lg:grid-cols-12',
        cards: [
            {
                name: "STATION 1",
                span: 'lg:col-span-10',
                // ✅ UPDATED: Include both 0 and 1 so we can check both
                stationIds: [0, 1],
                controls: [
                    { idx: 0, label: "TRANSP\n1", type: 'button', fb: { st: 1, bit: 0 } },
                    { idx: 1, label: "TRANSP\n2", type: 'button', fb: { st: 1, bit: 1 } },
                    // ST0 Controls (Vacuum)
                    { idx: 2, label: "VACUUM\n1", type: 'rocker', fb: { st: 1, bit: 2 }, targetSt: 0 }, // Added targetSt hint
                    { idx: 3, label: "VACUUM\n2", type: 'rocker', fb: { st: 1, bit: 2 }, targetSt: 0 },
                    // ST1 Controls
                    { idx: 4, label: "VID T1", type: 'rocker', fb: { st: 1, bit: 3 } },
                    { idx: 5, label: "OUV. T2", type: 'rocker', fb: { st: 1, bit: 4 } },
                    { idx: 6, label: "VID T2", type: 'rocker', fb: { st: 1, bit: 5 } },
                    { idx: 7, label: "VID\nS2>S1", type: 'rocker', fb: { st: 1, bit: 6 } },
                ]
            },
            {
                name: "THERMOSTAT\nST 1-2-3",
                span: 'lg:col-span-2',
                stationIds: [0], // Depends on ST0
                controls: [
                    { idx: 22, label: "ENABLE", type: 'rocker', special: 'TH1' }
                ]
            }
        ]
    },


    // --- ROW 2 ---
    {
        id: 'row2',
        cols: 'grid-cols-1 lg:grid-cols-2',
        cards: [
            {
                name: "STATION 2",
                span: 'col-span-1',
                stationIds: [2],
                controls: [
                    { idx: 8, label: "TRANSPORT", type: 'button', fb: { st: 2, bit: 0 } },
                    { idx: 9, label: "VACUUM", type: 'rocker', fb: { st: 2, bit: 1 } },
                    { idx: 10, label: "VID\nS1>S2", type: 'rocker', fb: { st: 2, bit: 2 } },
                    { idx: 11, label: "VID\nS3>S2", type: 'rocker', fb: { st: 2, bit: 3 } },
                ]
            },
            {
                name: "STATION 3",
                span: 'col-span-1',
                stationIds: [3],
                controls: [
                    { idx: 12, label: "TRANSP\n1", type: 'button', fb: { st: 3, bit: 0 } },
                    { idx: 13, label: "TRANSP\n2", type: 'button', fb: { st: 3, bit: 1 } },
                    { idx: 14, label: "VACUUM", type: 'rocker', fb: { st: 3, bit: 2 } },
                    { idx: 15, label: "VID\nS2>S3", type: 'rocker', fb: { st: 3, bit: 3 } },
                ]
            }
        ]
    },

    // --- ROW 3 ---
    {
        id: 'row3',
        cols: 'grid-cols-2 lg:grid-cols-6',
        cards: [
            {
                name: "STATION 4",
                span: 'col-span-2',
                stationIds: [4],
                controls: [
                    { idx: 16, label: "TRANSPORT", type: 'button', fb: { st: 4, bit: 0 } },
                    { idx: 17, label: "VACUUM", type: 'rocker', fb: { st: 4, bit: 1 } },
                    { idx: 18, label: "VID ST4", type: 'rocker', fb: { st: 4, bit: 2 } },
                ]
            },
            {
                name: "THERMOSTAT\nST 4-5",
                span: 'col-span-1',
                // ✅ CHANGE: Link to Station 4 so it greys out if ST4 is offline
                stationIds: [4],
                controls: [
                    { idx: 23, label: "ENABLE", type: 'rocker', special: 'TH2' }
                ]
            },
            {
                name: "STATION 5",
                span: 'col-span-2',
                stationIds: [5],
                controls: [
                    { idx: 19, label: "TRANSPORT", type: 'button', fb: { st: 5, bit: 0 } },
                    { idx: 20, label: "VID ST5", type: 'rocker', fb: { st: 5, bit: 1 } },
                ]
            },
            {
                name: "BAS VACUUM\nBUZZER",
                span: 'col-span-1',
                stationIds: [], // CHANGED: Always Online
                controls: [
                    { idx: 21, label: "ENABLE", type: 'rocker', special: 'BUZZER' }
                ]
            }
        ]
    }
];