import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:5000';

async function readSpinozaText(): Promise<string> {
  const filePath = path.join(process.cwd(), 'attached_assets', 'spinoza_works_1_1768511115533.txt');
  const rawText = fs.readFileSync(filePath, 'utf-8');
  // Join lines that are word-per-line back into normal text
  const lines = rawText.split('\n');
  let result = '';
  let currentParagraph = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') {
      if (currentParagraph) {
        result += currentParagraph + '\n\n';
        currentParagraph = '';
      }
    } else {
      currentParagraph += (currentParagraph ? ' ' : '') + trimmed;
    }
  }
  if (currentParagraph) {
    result += currentParagraph;
  }
  
  return result;
}

function saveResult(filename: string, content: any) {
  const outputPath = path.join(process.cwd(), 'test_results', filename);
  const data = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  fs.writeFileSync(outputPath, data);
  console.log(`Saved: ${outputPath}`);
}

async function testAnalyze(text: string, functionType: string, provider: string = 'openai'): Promise<any> {
  console.log(`\n=== Testing ${functionType} ===`);
  
  // Use a reasonable chunk for testing (first ~50000 chars for speed)
  const testText = text.substring(0, 50000);
  
  const response = await fetch(`${BASE_URL}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: testText,
      provider,
      functionType
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error(`Error in ${functionType}: ${error}`);
    return { error };
  }
  
  const result = await response.json();
  console.log(`${functionType} result keys:`, Object.keys(result));
  return result;
}

async function testPositionExtraction(text: string): Promise<any> {
  console.log(`\n=== Testing Position Extraction (depth 10) ===`);
  
  // Use first 100k chars for position extraction
  const testText = text.substring(0, 100000);
  
  const response = await fetch(`${BASE_URL}/api/positions/extract`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: testText,
      provider: 'openai',
      useOutlineMode: true,
      author: 'Spinoza',
      depth: 10
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error(`Error in positions: ${error}`);
    return { error };
  }
  
  const result = await response.json();
  console.log(`Positions found: ${result.positions?.length || 0}`);
  return result;
}

async function testOutline(text: string): Promise<any> {
  console.log(`\n=== Testing Outline Generation ===`);
  
  const testText = text.substring(0, 100000);
  
  const response = await fetch(`${BASE_URL}/api/outline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: testText,
      provider: 'openai'
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error(`Error in outline: ${error}`);
    return { error };
  }
  
  const result = await response.json();
  console.log(`Outline sections: ${result.sections?.length || 0}`);
  return result;
}

async function testIntelligence(text: string): Promise<any> {
  console.log(`\n=== Testing Intelligence Analysis ===`);
  
  const testText = text.substring(0, 50000);
  
  const response = await fetch(`${BASE_URL}/api/intelligence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: testText,
      provider: 'openai',
      authorName: 'Spinoza'
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error(`Error in intelligence: ${error}`);
    return { error };
  }
  
  const result = await response.json();
  console.log(`Intelligence result received`);
  return result;
}

async function testFullRewrite(text: string): Promise<any> {
  console.log(`\n=== Testing Full Rewrite ===`);
  
  const testText = text.substring(0, 30000);
  
  const response = await fetch(`${BASE_URL}/api/rewrite/full`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: testText,
      provider: 'openai'
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error(`Error in full rewrite: ${error}`);
    return { error };
  }
  
  const result = await response.json();
  console.log(`Rewrite result received`);
  return result;
}

async function testStylometrics(text: string): Promise<any> {
  console.log(`\n=== Testing Stylometrics ===`);
  
  const testText = text.substring(0, 30000);
  
  const response = await fetch(`${BASE_URL}/api/stylometrics/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: testText,
      authorName: 'Spinoza'
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    console.error(`Error in stylometrics: ${error}`);
    return { error };
  }
  
  const result = await response.json();
  console.log(`Stylometrics result received`);
  return result;
}

async function main() {
  console.log('Starting comprehensive test of all extraction functions...\n');
  console.log('Reading Spinoza text...');
  
  const spinozaText = await readSpinozaText();
  console.log(`Text length: ${spinozaText.length} characters (~${Math.round(spinozaText.split(/\s+/).length / 250)} pages)`);
  
  // Save the cleaned text
  saveResult('spinoza_cleaned.txt', spinozaText.substring(0, 200000));
  
  const results: Record<string, any> = {};
  
  // Test 1: Quote extraction (quotes function)
  try {
    results.quotes = await testAnalyze(spinozaText, 'quotes');
    saveResult('01_quotes.json', results.quotes);
  } catch (e: any) {
    console.error('Quote extraction failed:', e.message);
    results.quotes = { error: e.message };
  }
  
  // Test 2: Context extraction (annotated quotes)
  try {
    results.context = await testAnalyze(spinozaText, 'context');
    saveResult('02_context_quotes.json', results.context);
  } catch (e: any) {
    console.error('Context extraction failed:', e.message);
    results.context = { error: e.message };
  }
  
  // Test 3: Rewrite/Summary
  try {
    results.rewrite = await testAnalyze(spinozaText, 'rewrite');
    saveResult('03_rewrite_summary.json', results.rewrite);
  } catch (e: any) {
    console.error('Rewrite failed:', e.message);
    results.rewrite = { error: e.message };
  }
  
  // Test 4: Database generation
  try {
    results.database = await testAnalyze(spinozaText, 'database');
    saveResult('04_database.json', results.database);
  } catch (e: any) {
    console.error('Database failed:', e.message);
    results.database = { error: e.message };
  }
  
  // Test 5: Analyzer
  try {
    results.analyzer = await testAnalyze(spinozaText, 'analyzer');
    saveResult('05_analyzer.json', results.analyzer);
  } catch (e: any) {
    console.error('Analyzer failed:', e.message);
    results.analyzer = { error: e.message };
  }
  
  // Test 6: Views extraction
  try {
    results.views = await testAnalyze(spinozaText, 'views');
    saveResult('06_views.json', results.views);
  } catch (e: any) {
    console.error('Views extraction failed:', e.message);
    results.views = { error: e.message };
  }
  
  // Test 7: Position extraction (holistic)
  try {
    results.positions = await testPositionExtraction(spinozaText);
    saveResult('07_positions.json', results.positions);
    
    // Also save as readable text
    if (results.positions.positions?.length > 0) {
      const positionsText = results.positions.positions
        .map((p: any, i: number) => `${i + 1}. [${p.source}] "${p.quote}"`)
        .join('\n\n');
      saveResult('07_positions.txt', positionsText);
    }
  } catch (e: any) {
    console.error('Position extraction failed:', e.message);
    results.positions = { error: e.message };
  }
  
  // Test 8: Outline
  try {
    results.outline = await testOutline(spinozaText);
    saveResult('08_outline.json', results.outline);
  } catch (e: any) {
    console.error('Outline failed:', e.message);
    results.outline = { error: e.message };
  }
  
  // Test 9: Full Rewrite
  try {
    results.fullRewrite = await testFullRewrite(spinozaText);
    saveResult('09_full_rewrite.json', results.fullRewrite);
  } catch (e: any) {
    console.error('Full rewrite failed:', e.message);
    results.fullRewrite = { error: e.message };
  }
  
  // Test 10: Intelligence
  try {
    results.intelligence = await testIntelligence(spinozaText);
    saveResult('10_intelligence.json', results.intelligence);
  } catch (e: any) {
    console.error('Intelligence failed:', e.message);
    results.intelligence = { error: e.message };
  }
  
  // Test 11: Stylometrics
  try {
    results.stylometrics = await testStylometrics(spinozaText);
    saveResult('11_stylometrics.json', results.stylometrics);
  } catch (e: any) {
    console.error('Stylometrics failed:', e.message);
    results.stylometrics = { error: e.message };
  }
  
  // Summary
  console.log('\n\n========== TEST SUMMARY ==========');
  for (const [name, result] of Object.entries(results)) {
    if (result.error) {
      console.log(`❌ ${name}: FAILED - ${result.error}`);
    } else {
      const count = result.quotes?.length || result.annotatedQuotes?.length || 
                    result.positions?.length || result.views?.length || 
                    (result.summary ? 1 : 0) || (result.database ? 1 : 0) || 
                    (result.analyzer ? 1 : 0) || 1;
      console.log(`✅ ${name}: SUCCESS (${count} items)`);
    }
  }
  
  // Save full summary
  saveResult('00_test_summary.json', results);
  
  console.log('\n\nAll results saved to test_results/ directory');
}

main().catch(console.error);
