// index.js
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');

const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');

// Cấu hình Database (Lịch sử)
const adapter = new FileSync('db.json');
const db = low(adapter);

// Cấu hình Database mặc định
db.defaults({ history: [] }).write();

const app = express();
const PORT = process.env.PORT || 3000;
const EXAM_QUESTION_LIMIT = 65; // Giới hạn số câu hỏi trong bài thi

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: true,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 24 hours
}));

const QUESTIONS_FILE_PATH = path.join(__dirname, 'data', 'questions.json');
const EXPLAIN_FILE_PATH = path.join(__dirname, 'Explain.txt');


// ----------------------------------------------------------------------
// CORE FUNCTIONS
// ----------------------------------------------------------------------

// 1. Load Questions (Pool)
function loadQuestions() {
  try {
    const data = fs.readFileSync(QUESTIONS_FILE_PATH, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Lỗi khi đọc file questions.json:', err);
    return [];
  }
}

// 2. Hàm xáo trộn mảng (Fisher-Yates)
function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

// 3. Hàm phân tích file giải thích
function parseExplanations(rawContent) {
  const explanations = {};
  const parts = rawContent.split(/(\d+\.Explain)/).filter(p => p.trim() !== '');

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.match(/^\d+\.Explain$/)) {
      const qNumMatch = part.match(/(\d+)/);
      if (qNumMatch && i + 1 < parts.length) {
        const qNum = qNumMatch[1];
        explanations[qNum] = parts[i+1].trim();
        i++;
      }
    }
  }
  return explanations;
}

// 4. Hàm tải giải thích
function loadExplanations() {
    try {
        const rawData = fs.readFileSync(EXPLAIN_FILE_PATH, 'utf8');
        return parseExplanations(rawData);
    } catch (err) {
        console.error('Lỗi khi đọc file Explain.txt:', err);
        return {}; 
    }
}

// 5. Hàm định dạng thời gian (THE FIX)
function formatTimestamp(timestamp) {
    if (!timestamp) return 'N/A';
    const date = new Date(timestamp);
    try {
        const datePart = date.toLocaleDateString('vi-VN');
        const timePart = date.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return timePart + ' ' + datePart;
    } catch (e) {
        return date.toLocaleString();
    }
}

// 6. HÀM MỚI: TÍNH TOÁN THỐNG KÊ CÂU HỎI
function getQuestionStats() {
    const questionsRaw = loadQuestions();
    const history = db.get('history').value();
    const totalQuestionCount = questionsRaw.length;

    // Khởi tạo bộ đếm cho tất cả câu hỏi trong Pool
    const stats = {};
    for (let i = 1; i <= totalQuestionCount; i++) {
        stats[i] = 0;
    }

    // Tổng hợp số lần xuất hiện từ lịch sử
    history.forEach(entry => {
        // entry.results chứa poolQNum (ID gốc trong Pool)
        entry.results.forEach(result => {
            const poolID = result.poolQNum;
            if (stats.hasOwnProperty(poolID)) {
                stats[poolID]++;
            }
        });
    });

    // Chuyển đổi sang mảng để render
    const statsArray = [];
    for (let i = 1; i <= totalQuestionCount; i++) {
        statsArray.push({
            qNum: i,
            count: stats[i]
        });
    }

    return {
        stats: statsArray,
        totalCount: totalQuestionCount
    };
}


// === FIX: GẮN HÀM VÀO app.locals ĐỂ EJS CÓ THỂ GỌI ===
app.locals.formatTimestamp = formatTimestamp;


// ----------------------------------------------------------------------
// ROUTES
// ----------------------------------------------------------------------

// 1. Trang chủ
app.get('/', (req, res) => {
  const { stats, totalCount } = getQuestionStats();
  res.render('index', {
    questionStats: stats,
    totalPoolQuestions: totalCount
  });
});

// 2. Route Bắt đầu bài thi (Bốc thăm ngẫu nhiên, giới hạn 65 câu và Ánh xạ)
app.post('/start', (req, res) => {
  const questionsRaw = loadQuestions();
  const { stats } = getQuestionStats(); // Lấy thống kê số lần thi

  if (questionsRaw.length === 0) {
    req.session.error = "Không có câu hỏi nào trong Pool.";
    return res.redirect('/');
  }

  // 1. Gắn số lần thi (count) vào từng câu hỏi trong Pool
  const questionsWithStats = questionsRaw.map(q => {
    // Tìm số lần thi của câu hỏi này (stats là mảng, cần tìm theo qNum/id)
    const statItem = stats.find(s => s.qNum === q.id);
    const count = statItem ? statItem.count : 0;
    return {
      ...q,
      count: count
    };
  });

  // 2. Sắp xếp: Ưu tiên câu hỏi có số lần thi (count) ít hơn
  // Nếu số lần thi bằng nhau, việc sắp xếp không cố định sẽ tạo ra tính ngẫu nhiên ngang hàng
  questionsWithStats.sort((a, b) => a.count - b.count);

  // 3. Lựa chọn các câu hỏi tiềm năng (Ưu tiên)
  // Chọn tất cả câu hỏi, nhưng đã được sắp xếp.
  let potentialQuestions = questionsWithStats; 

  // 4. Áp dụng Ngẫu nhiên Ngang hàng (Trong nhóm có cùng count)
  // Chúng ta sẽ chia Pool thành các nhóm có cùng số lần thi (count), sau đó xáo trộn nội bộ.
  const groupedQuestions = potentialQuestions.reduce((groups, question) => {
      const key = question.count;
      if (!groups[key]) {
          groups[key] = [];
      }
      groups[key].push(question);
      return groups;
  }, {});

  let questionsForExam = [];
  
  // Xáo trộn nội bộ từng nhóm (đảm bảo ngẫu nhiên ngang hàng) và gộp lại
  Object.keys(groupedQuestions).sort((a, b) => a - b).forEach(count => {
      shuffleArray(groupedQuestions[count]);
      questionsForExam = questionsForExam.concat(groupedQuestions[count]);
  });

  // 5. Giới hạn số câu hỏi cho bài thi
  questionsForExam = questionsForExam.slice(0, EXAM_QUESTION_LIMIT);
  
  // 6. Tạo Map và gán lại ID từ 1 đến 65 (ID trong bài thi)
  const questionMap = {};
  const finalExamQuestions = [];
  
  questionsForExam.forEach((q, index) => {
    // questionMap: ID trong bài thi (1..65) -> ID trong Pool gốc (q.id)
    questionMap[index + 1] = q.id; 
    
    finalExamQuestions.push({
        ...q,
        id: index + 1 // Gán lại ID bài thi
    });
  });
  
  req.session.exam = {
    questions: finalExamQuestions,
    questionMap: questionMap,
    totalQuestions: finalExamQuestions.length,
    userAnswers: {},
    startTime: Date.now(),
    timeLimit: 180 * 60 // 180 phút
  };

  res.redirect('/exam/1');
});

// 3. Route Xử lý câu trả lời
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

  // Điều hướng
  if (jumpTo) {
    res.redirect(`/exam/${jumpTo}`);
  } else if (action === 'next') {
    res.redirect(`/exam/${currentQNum + 1}`);
  } else if (action === 'back') {
    res.redirect(`/exam/${currentQNum - 1}`);
  } else if (action === 'finish') {
    res.redirect('/results');
  } else {
    res.redirect(`/exam/${currentQNum}`);
  }
});

// 4. Route Chi tiết câu hỏi
app.get('/exam/:qNum', (req, res) => {
  if (!req.session.exam) {
    return res.redirect('/');
  }

  const qNum = parseInt(req.params.qNum);
  const { questions, totalQuestions, userAnswers, startTime, timeLimit } = req.session.exam;
  
  const question = questions.find(q => q.id === qNum); 

  if (!question) {
    return res.redirect('/');
  }

  res.render('exam', {
    qNum: qNum,
    question: question,
    totalQuestions: totalQuestions,
    userAnswers: userAnswers,
    startTime: startTime,
    timeLimit: timeLimit
  });
});

// 5. Trang kết quả
app.get('/results', (req, res) => {
  if (!req.session.exam || !req.session.exam.userAnswers) {
    const latestHistory = db.get('history').orderBy('timestamp', 'desc').first().value();
    if (latestHistory) {
      return res.redirect(`/history/${latestHistory.id}`);
    }
    return res.redirect('/');
  }

  const { questions, userAnswers, totalQuestions, questionMap } = req.session.exam;
  
  const results = questions.map(q => {
    const poolQNum = questionMap[q.id]; 

    const correctOptions = q.options
      .map((opt, index) => opt.isCorrect ? (index + 1).toString() : null)
      .filter(id => id !== null);
    
    const userAns = userAnswers[q.id] || [];
    
    const isCorrect = userAns.length === correctOptions.length && 
                      userAns.every(ans => correctOptions.includes(ans));
                      
    return {
      qNum: q.id,
      poolQNum: poolQNum,
      question: q,
      userAns: userAns,
      correctOptions: correctOptions,
      isCorrect: isCorrect
    };
  });
  
  const score = results.filter(r => r.isCorrect).length;
  const totalScore = (score / totalQuestions) * 100;
  
  const questionExplanations = loadExplanations(); 
  
  db.get('history')
    .push({
      id: Date.now().toString(),
      timestamp: Date.now(),
      score: totalScore.toFixed(2),
      results: results,
      questionMap: questionMap
    })
    .write();

  req.session.exam = null;

  res.render('results', {
    results: results,
    score: score,
    totalScore: totalScore.toFixed(2),
    totalQuestions: totalQuestions,
    userAnswers: userAnswers,
    explanations: questionExplanations,
    questionMap: questionMap
  });
});

// 6. Trang lịch sử
app.get('/history', (req, res) => {
  const history = db.get('history').orderBy('timestamp', 'desc').value();
  res.render('history', { 
    history: history
  });
});

// 7. Xem lại một bài thi cũ
app.get('/history/:id', (req, res) => {
  const entry = db.get('history').find({ id: req.params.id }).value();
  if (!entry) {
    return res.redirect('/history');
  }

  const questionExplanations = loadExplanations();

  res.render('results', {
    results: entry.results,
    score: entry.results.filter(r => r.isCorrect).length,
    totalScore: entry.score,
    totalQuestions: entry.results.length,
    userAnswers: entry.results.reduce((acc, r) => {
      acc[r.qNum] = r.userAns;
      return acc;
    }, {}),
    explanations: questionExplanations,
    questionMap: entry.questionMap
  });
});

// 8. Route Xóa lịch sử
app.post('/history/clear', (req, res) => {
  db.set('history', []).write();
  res.redirect('/history');
});


// Khởi động server
app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});

//  Route Chức năng Học bài
app.get('/study', (req, res) => {
    // Tải toàn bộ câu hỏi gốc từ pool
    const questions = loadQuestions(); 
    
    // Tải toàn bộ lời giải thích
    const explanations = loadExplanations();

    // Sắp xếp câu hỏi theo ID gốc để hiển thị theo thứ tự
    questions.sort((a, b) => a.id - b.id);
    
    // Tạo mảng kết quả để render
    const studyItems = questions.map(q => {
        // Tìm đáp án đúng để hiển thị
        const correctOptions = q.options
            .map((opt, index) => opt.isCorrect ? (index + 1).toString() : null)
            .filter(id => id !== null);

        return {
            qNum: q.id, // ID gốc trong pool
            question: q,
            correctOptions: correctOptions,
            explanation: explanations[q.id] || "Không có giải thích chi tiết."
        };
    });

    res.render('study', {
        studyItems: studyItems
    });
});