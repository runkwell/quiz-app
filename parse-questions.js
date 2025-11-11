// parse-questions.js
const fs = require('fs');

// Hàm để phân tích cú pháp Markdown cho hình ảnh
function parseImageMarkdown(text) {
  const imgRegex = /!\[.*?\]\((.*?)\)/;
  const match = text.match(imgRegex);
  if (match) {
    const imagePath = match[1];
    const plainText = text.replace(imgRegex, '').trim(); // Xóa markdown khỏi text
    return { text: plainText, image: imagePath };
  }
  return { text: text, image: null };
}

// Hàm phân tích các lựa chọn
function parseOption(line) {
  const isCorrect = line.startsWith('- [x]');
  const text = line.substring(line.indexOf(']') + 1).trim();
  const content = parseImageMarkdown(text);
  
  return {
    text: content.text,
    image: content.image,
    isCorrect: isCorrect
  };
}

try {
  const data = fs.readFileSync('pool.txt', 'utf8');
  const questionsRaw = data.split('--------------------------------------------------');
  
  const questionsJson = [];
  let questionCounter = 1;

  for (const q of questionsRaw) {
    if (q.trim().length === 0) continue;

    const lines = q.trim().split('\n');
    
    // Dòng đầu tiên là câu hỏi
    const questionLine = lines[0].substring(lines[0].indexOf('.') + 1).trim();
    const questionContent = parseImageMarkdown(questionLine);
    
    const options = [];
    let correctCount = 0;
    
    // Các dòng còn lại là lựa chọn
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim().startsWith('- [')) {
        const option = parseOption(lines[i]);
        options.push(option);
        if (option.isCorrect) {
          correctCount++;
        }
      }
    }
    
    questionsJson.push({
      id: questionCounter++,
      questionText: questionContent.text,
      questionImage: questionContent.image,
      options: options,
      isMultipleChoice: correctCount > 1 // Kiểm tra xem có phải câu nhiều lựa chọn không
    });
  }

  fs.writeFileSync('./data/questions.json', JSON.stringify(questionsJson, null, 2));
  console.log(`Đã xử lý thành công ${questionsJson.length} câu hỏi vào data/questions.json`);

} catch (err) {
  console.error('Lỗi khi đọc hoặc xử lý file:', err);
}