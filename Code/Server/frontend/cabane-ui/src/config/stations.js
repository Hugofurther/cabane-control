export const PANEL_LAYOUT = [
    // --- ROW 1 ---
    {
        id: 'row1',
        cols: 'grid-cols-1 lg:grid-cols-12',
        cards: [
            {
                name: "station_names.st1", // ✅ Key
                span: 'lg:col-span-10',
                stationIds: [0, 1],
                controls: [
                    { idx: 0, label: "labels.transp_1", type: 'button', fb: { st: 1, bit: 0 } },
                    { idx: 1, label: "labels.transp_2", type: 'button', fb: { st: 1, bit: 1 } },
                    // ST0 Controls (Vacuum)
                    { idx: 2, label: "labels.vacuum_1", type: 'rocker', fb: { st: 1, bit: 2 }, targetSt: 0 },
                    { idx: 3, label: "labels.vacuum_2", type: 'rocker', fb: { st: 1, bit: 2 }, targetSt: 0 },
                    // ST1 Controls
                    { idx: 4, label: "labels.vid_t1", type: 'rocker', fb: { st: 1, bit: 3 } },
                    { idx: 5, label: "labels.ouv_t2", type: 'rocker', fb: { st: 1, bit: 4 } },
                    { idx: 6, label: "labels.vid_t2", type: 'rocker', fb: { st: 1, bit: 5 } },
                    { idx: 7, label: "labels.vid_s2_s1", type: 'rocker', fb: { st: 1, bit: 6 } },
                ]
            },
            {
                name: "station_names.th_123", // ✅ Key
                span: 'lg:col-span-2',
                stationIds: [0],
                controls: [
                    { idx: 22, label: "labels.enable", type: 'rocker', special: 'TH1' }
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
                name: "station_names.st2", // ✅ Key
                span: 'col-span-1',
                stationIds: [2],
                controls: [
                    { idx: 8, label: "labels.transp", type: 'button', fb: { st: 2, bit: 0 } },
                    { idx: 9, label: "labels.vacuum", type: 'rocker', fb: { st: 2, bit: 1 } },
                    { idx: 10, label: "labels.vid_s1_s2", type: 'rocker', fb: { st: 2, bit: 2 } },
                    { idx: 11, label: "labels.vid_s3_s2", type: 'rocker', fb: { st: 2, bit: 3 } },
                ]
            },
            {
                name: "station_names.st3", // ✅ Key
                span: 'col-span-1',
                stationIds: [3],
                controls: [
                    { idx: 12, label: "labels.transp_1", type: 'button', fb: { st: 3, bit: 0 } },
                    { idx: 13, label: "labels.transp_2", type: 'button', fb: { st: 3, bit: 1 } },
                    { idx: 14, label: "labels.vacuum", type: 'rocker', fb: { st: 3, bit: 2 } },
                    { idx: 15, label: "labels.vid_s2_s3", type: 'rocker', fb: { st: 3, bit: 3 } },
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
                name: "station_names.st4",
                span: 'col-span-2',
                stationIds: [4],
                controls: [
                    { idx: 16, label: "labels.transp", type: 'button', fb: { st: 4, bit: 0 } },
                    { idx: 17, label: "labels.vacuum", type: 'rocker', fb: { st: 4, bit: 1 } },
                    { idx: 18, label: "labels.vid_st4", type: 'rocker', fb: { st: 4, bit: 2 } },
                ]
            },
            {
                name: "station_names.th_45",
                span: 'col-span-1',
                stationIds: [4],
                controls: [
                    { idx: 23, label: "labels.enable", type: 'rocker', special: 'TH2' }
                ]
            },
            {
                name: "station_names.st5",
                span: 'col-span-2',
                // ✅ CHANGED: This card now monitors Station 4 for offline status
                stationIds: [4],
                controls: [
                    // ✅ CHANGED: Feedback now comes from Station 4
                    { idx: 19, label: "labels.transp", type: 'button', fb: { st: 4, bit: 4 } },
                    { idx: 20, label: "labels.vid_st5", type: 'rocker', fb: { st: 4, bit: 5 } },
                ]
            },
            {
                name: "station_names.buzzer", // ✅ Key
                span: 'col-span-1',
                stationIds: [],
                controls: [
                    { idx: 21, label: "labels.enable", type: 'rocker', special: 'BUZZER' }
                ]
            }
        ]
    }
];