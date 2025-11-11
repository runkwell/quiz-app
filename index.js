// index.js
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

// --- Thiết lập CSDL lịch sử ---
const adapter = new FileSync('db.json');
const db = low(adapter);
db.defaults({ history: [] }).write();

// --- Thiết lập Express ---
const app = express();
const PORT = 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true })); // Để đọc dữ liệu form
app.use(session({
  secret: 'my-secret-key-12345', // Đổi key này thành 1 chuỗi bí mật
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 180 * 60 * 1000 + 10000 } // Hết hạn sau 180 phút + 10s
}));

// --- Hàm trợ giúp ---
function loadQuestions() {
  const rawData = fs.readFileSync(path.join(__dirname, 'data/questions.json'));
  return JSON.parse(rawData);
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

// --- Các Route (Đường dẫn) ---

// 1. Trang chủ
app.get('/', (req, res) => {
  res.render('index');
});

// 2. Bắt đầu bài thi (Nhấn nút "Bắt đầu")
app.post('/start', (req, res) => {
  const allQuestions = loadQuestions();
  const shuffledQuestions = shuffle([...allQuestions]);
  const examQuestions = shuffledQuestions.slice(0, 65);
  
  req.session.exam = {
    questions: examQuestions,
    userAnswers: {}, // Lưu câu trả lời của người dùng
    startTime: Date.now()
  };
  
  res.redirect('/exam/1');
});

// 3. Trang làm bài thi (ví dụ: /exam/5 là câu số 5)
app.get('/exam/:qNum', (req, res) => {
  if (!req.session.exam) {
    return res.redirect('/');
  }

  const qNum = parseInt(req.params.qNum);
  if (isNaN(qNum) || qNum < 1 || qNum > 65) {
    return res.redirect('/exam/1');
  }

  const { questions, userAnswers, startTime } = req.session.exam;
  const question = questions[qNum - 1]; // Lấy câu hỏi hiện tại (index 0)

  res.render('exam', {
    question: question,
    qNum: qNum,
    totalQuestions: 65,
    userAnswers: userAnswers,
    startTime: startTime,
    timeLimit: 180 * 60 // 180 phút
  });
});

// 4. Nộp câu trả lời (Next, Back, Jump, Finish)
// index.js

// ... (các code khác giữ nguyên) ...

app.post('/submit-answer', (req, res) => {
  if (!req.session.exam) {
    return res.redirect('/');
  }

  const { qNum, action, jumpTo } = req.body;
  const currentQNum = parseInt(qNum);
  
  // Lưu câu trả lời
  let answer = req.body.answer;
  if (answer) {
    req.session.exam.userAnswers[currentQNum] = Array.isArray(answer) ? answer : [answer];
  } else {
    req.session.exam.userAnswers[currentQNum] = [];
  }

  // === SỬA LOGIC ĐIỀU HƯỚNG TẠI ĐÂY ===
  // Ưu tiên 'jumpTo' trước, nếu nó tồn tại, chúng ta luôn nhảy
  if (jumpTo) {
    res.redirect(`/exam/${jumpTo}`);
  } else if (action === 'next') {
    res.redirect(`/exam/${currentQNum + 1}`);
  } else if (action === 'back') {
    res.redirect(`/exam/${currentQNum - 1}`);
  } else if (action === 'finish') {
    res.redirect('/results');
  } else {
    // Trường hợp dự phòng nếu không có hành động nào
    res.redirect(`/exam/${currentQNum}`);
  }
});

// ... (các code khác giữ nguyên) ...

// 5. Trang kết quả
app.get('/results', (req, res) => {
  if (!req.session.exam) {
    return res.redirect('/');
  }

  const { questions, userAnswers } = req.session.exam;
  let score = 0;
  
  // Tính toán kết quả
  const results = questions.map((q, index) => {
    const qNum = index + 1;
    const correctOptions = q.options
      .map((opt, optIndex) => opt.isCorrect ? (optIndex + 1).toString() : null)
      .filter(Boolean);
      
    const userAns = userAnswers[qNum] || [];
    
    // So sánh (phải chính xác tuyệt đối)
    const isCorrect = userAns.length === correctOptions.length &&
                      userAns.every(ans => correctOptions.includes(ans)) &&
                      correctOptions.every(ans => userAns.includes(ans));
                      
    if (isCorrect) {
      score++;
    }

    return {
      qNum: qNum,
      question: q,
      userAns: userAns,
      correctOptions: correctOptions,
      isCorrect: isCorrect
    };
  });

  const totalScore = (score / 65) * 100;

  // Lưu vào lịch sử
  const historyEntry = {
    id: Date.now().toString(),
    date: new Date().toLocaleString('vi-VN'),
    score: totalScore.toFixed(2),
    results: results // Lưu chi tiết kết quả
  };
  db.get('history').push(historyEntry).write();
  
const EXPLAIN_FILE_PATH = path.join(__dirname, 'Explain.txt');

// Hàm phân tích file giải thích
function parseExplanations(rawContent) {
  const explanations = {};
  // Tách nội dung theo cú pháp [số].Explain
  const parts = rawContent.split(/(\d+\.Explain)/).filter(p => p.trim() !== '');

  let currentQ = null;
  for (const part of parts) {
    if (part.match(/\d+\.Explain/)) {
      // Tìm số câu hỏi
      currentQ = part.match(/(\d+)/)[1];
    } else if (currentQ) {
      // Lưu nội dung giải thích
      explanations[currentQ] = part.trim();
      currentQ = null; 
    }
  }
  return explanations;
}

// Hàm tải giải thích
function loadExplanations() {
    try {
        // Đọc file Explain.txt
        const rawData = fs.readFileSync(EXPLAIN_FILE_PATH, 'utf8');
        return parseExplanations(rawData);
    } catch (err) {
        // Ghi log nếu lỗi đọc file
        console.error('Lỗi khi đọc file Explain.txt (Đảm bảo file đã được tạo và lưu ở thư mục gốc):', err);
        return {}; // Trả về object rỗng nếu lỗi
    }
}

// Tải giải thích
  const questionExplanations = loadExplanations();

  // Xóa session thi
  req.session.exam = null;

  res.render('results', {
    results: results,
    score: score,
    totalScore: totalScore.toFixed(2),
    totalQuestions: 65,
    userAnswers: userAnswers, // Gửi để tô màu overview
    explanations: questionExplanations // TRUYỀN DỮ LIỆU
  });
});

// 6. Trang Lịch sử
app.get('/history', (req, res) => {
  const history = db.get('history').orderBy('date', 'desc').value();
  res.render('history', { history: history });
});

// 7. Xem lại một bài thi cũ
app.get('/history/:id', (req, res) => {
  const entry = db.get('history').find({ id: req.params.id }).value();
  if (!entry) {
    return res.redirect('/history');
  }

  // Tải giải thích
  const questionExplanations = loadExplanations();

  res.render('results', {
    results: entry.results,
    score: (parseFloat(entry.score) / 100) * 65,
    totalScore: entry.score,
    totalQuestions: 65,
    userAnswers: entry.results.reduce((acc, r) => {
      acc[r.qNum] = r.userAns;
      return acc;
    }, {}),
    explanations: questionExplanations // TRUYỀN DỮ LIỆU
  });
});

// Khởi chạy server
app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});