export const DEFAULT_GROUPS = {
    list: ['A', '☓ ', 'D', 'C', 'B', 'E'],
    pinned: ['A'],
    selected: '☓ '
};

export const DEFAULT_PROFILE_ID = 'macbook';

export const DEFAULT_PROFILES = {
    macbook: {
        pinned: ['A'],
        selected: '☓ ',
        settings: {
            iconSize: 56
        }
    },
    mobile: {
        pinned: ['A'],
        selected: '☓ ',
        settings: {
            iconSize: 52
        }
    }
};

export const DEFAULT_LINKS = [
    { _id: 'linksirdilh', order: 0, parent: 'A', title: 'Alpha123', url: 'https://alpha123.uk/' },
    { _id: 'linkspjqank', order: 1, parent: 'A', title: 'Phần mềm', url: 'https://voz.vn/f/phan-mem.13/' },
    { _id: 'linksiaildg', order: 2, parent: 'A', title: 'Điểm báo', url: 'https://voz.vn/f/diem-bao.33/' },
    { _id: 'linksjkobho', order: 3, parent: 'A', title: 'Tiền điện tử', url: 'https://voz.vn/f/tien-dien-tu.94/' },
    { _id: 'linksmhdkob', order: 4, parent: 'A', title: 'TikTok', url: 'https://www.tiktok.com/' },
    { _id: 'linkspdgigl', order: 5, parent: 'A', title: 'Google Drive', url: 'https://drive.google.com/drive/u/0/shared-with-me' },
    { _id: 'linksdrfjea', order: 6, parent: 'A', title: 'X', url: 'https://x.com/home' },
    { _id: 'linksifdjnm', order: 7, parent: 'A', title: 'Reddit', url: 'https://www.reddit.com/' },
    { _id: 'linksbajhdk', order: 8, parent: 'A', title: 'YouTube', url: 'https://m.youtube.com/' },
    { _id: 'linksihghle', order: 9, parent: 'A', title: 'Music', url: 'https://music.youtube.com/' },
    { _id: 'linksjllafc', order: 10, parent: 'A', title: 'Keep', url: 'https://keep.google.com/' },
    { _id: 'linkseqcapk', order: 11, parent: 'A', title: 'LiteApks', url: 'https://Liteapks.com' },
    { _id: 'linksrmodic', order: 12, parent: 'A', title: 'Facebook', url: 'https://www.facebook.com/' },
    { _id: 'linkslmqnkk', order: 13, parent: 'A', title: 'CoinGecko', url: 'https://www.coingecko.com/' },
    { _id: 'linksqglcbe', order: 14, parent: 'A', title: 'CoinMarket', url: 'https://coinmarketcap.com/' },
    { _id: 'linksakhirh', order: 15, parent: 'A', title: 'GitHub', url: 'https://github.com/' },

    { _id: 'linksopffim', order: 0, parent: '☓ ', title: 'ChatGPT', url: 'https://chatgpt.com' },
    { _id: 'linksckcgld', order: 1, parent: '☓ ', title: 'NotebookLM', url: 'https://notebooklm.google.com/' },
    { _id: 'linksofclid', order: 2, parent: '☓ ', title: 'Perplexity', url: 'https://www.perplexity.ai/' },
    { _id: 'linksekhmnb', order: 3, parent: '☓ ', title: 'AI Studio', url: 'https://aistudio.google.com/' },
    { _id: 'linksicqqko', order: 4, parent: '☓ ', title: 'Gemini', url: 'https://gemini.google.com/' },
    { _id: 'linksljpijl', order: 5, parent: '☓ ', title: 'Qwen', url: 'https://chat.qwen.ai/' },
    { _id: 'linksnkofpq', order: 6, parent: '☓ ', title: 'Grok', url: 'https://grok.com/' },
    { _id: 'linksebpgen', order: 7, parent: '☓ ', title: 'Poe', url: 'https://poe.com/' },
    { _id: 'linksdmflab', order: 8, parent: '☓ ', title: 'DeepSeek', url: 'https://chat.deepseek.com' },
    { _id: 'linksedamjh', order: 9, parent: '☓ ', title: 'Claude', url: 'https://claude.ai/new' },
    { _id: 'linksmejbmo', order: 10, parent: '☓ ', title: 'Kimi', url: 'https://www.kimi.com/' },
    { _id: 'linksfbbmpd', order: 11, parent: '☓ ', title: 'AI Studio Chat', url: 'https://aistudio.google.com/prompts/new_chat' },
    { _id: 'linksnojfhm', order: 12, parent: '☓ ', title: 'Z.AI', url: 'https://chat.z.ai/' },

    { _id: 'linkslqqmfc', order: 0, parent: 'C', title: 'CME Đăng ký', url: 'https://cme.bvhungvuong.vn/course/DangKyDT' },
    { _id: 'linksomcfqn', order: 1, parent: 'C', title: 'Chỉ đạo tuyến', url: 'http://choray.vn/ttchidaotuyen/Default.aspx?tabid=277&language=vi-VN' },
    { _id: 'linkshqrpig', order: 2, parent: 'C', title: 'CME Courses', url: 'https://cme.bvhungvuong.vn/Course/Index' },
    { _id: 'linksodedll', order: 3, parent: 'C', title: 'CTUMP', url: 'https://htql.ctump.edu.vn/ctump/dichvucong/ttdv/' },
    { _id: 'linksdgaggl', order: 4, parent: 'C', title: 'Dịch vụ công', url: 'https://dichvucong.gov.vn/p/home/dvc-dich-vu-cong-cua-toi.html' },
    { _id: 'linksqbpgdd', order: 5, parent: 'C', title: 'Ente Auth', url: 'https://auth.ente.io/auth' },

    { _id: 'linksegljrm', order: 0, parent: 'D', title: 'TheFetus', url: 'https://thefetus.net/' },
    { _id: 'linksqgqqja', order: 1, parent: 'D', title: 'RIS', url: 'http://113.161.160.233/ris/study/reading' },
    { _id: 'linkshhlpmc', order: 2, parent: 'D', title: 'Radiology Asst', url: 'https://radiologyassistant.nl/' },
    { _id: 'linksllqbih', order: 3, parent: 'D', title: 'Radiopaedia', url: 'https://radiopaedia.org/search?page=1&scope=articles&section=Classifications&sort=date_of_last_edit&system=Gynaecology' },
    { _id: 'linksnbakpc', order: 4, parent: 'D', title: 'Radiopaedia User', url: 'https://radiopaedia.org/users/maulikspatel' },
    { _id: 'linksnpjmgk', order: 5, parent: 'D', title: 'PACS HMU', url: 'https://pacs.benhviendaihocyhanoi.com/ris/study/reading#listStudy' },
    { _id: 'linkslnjldf', order: 6, parent: 'D', title: 'YDS', url: 'https://pacs.umc.edu.vn/portal/' },
    { _id: 'linksrfmmka', order: 7, parent: 'D', title: 'CR', url: 'https://bvcr.ddns.net/portal/' },
    { _id: 'linksoagblo', order: 8, parent: 'D', title: 'Ultrasound', url: 'https://www.ultrasoundcases.info/cases' },

    { _id: 'linksbokpll', order: 16, parent: 'E', title: 'Telegram', url: 'https://web.telegram.org/a/' },
    { _id: 'linkscjncge', order: 17, parent: 'E', title: 'Notion', url: 'https://www.notion.so/23ee294244cd4904ace8a548a8ffd74e' },
    { _id: 'linkslaabcd', order: 18, parent: 'E', title: 'Transfer.it', url: 'https://transfer.it/start' },
    { _id: 'linksdjinjd', order: 19, parent: 'E', title: 'Chợ Tốt', url: 'https://www.chotot.com/' }
];

export const DEFAULT_SETTINGS = {
    iconSize: 56
};
