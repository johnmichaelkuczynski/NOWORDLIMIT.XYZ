import * as mammoth from 'mammoth';
import pdfParse from 'pdf-parse-new';

async function parsePDF(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text || '';
}

const ALLOWED_EXTENSIONS = ['pdf', 'doc', 'docx', 'txt', 'md', 'text'];
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'text/markdown'
];

export interface ParsedFile {
  text: string;
  wordCount: number;
  fileName: string;
  fileType: string;
}

export async function parseFile(buffer: Buffer, fileName: string, mimeType: string): Promise<ParsedFile> {
  const extension = fileName.toLowerCase().split('.').pop() || '';
  
  // Validate file type
  const isAllowedExtension = ALLOWED_EXTENSIONS.includes(extension);
  const isAllowedMime = ALLOWED_MIME_TYPES.includes(mimeType) || mimeType.startsWith('text/');
  
  if (!isAllowedExtension && !isAllowedMime) {
    throw new Error(`Unsupported file type: ${extension || mimeType}. Allowed types: PDF, Word (.doc/.docx), and text files.`);
  }
  
  let text = '';
  let fileType = 'unknown';

  if (mimeType === 'application/pdf' || extension === 'pdf') {
    fileType = 'pdf';
    try {
      text = await parsePDF(buffer);
    } catch (error: any) {
      throw new Error(`Failed to parse PDF: ${error.message}`);
    }
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mimeType === 'application/msword' ||
    extension === 'docx' ||
    extension === 'doc'
  ) {
    fileType = extension === 'doc' ? 'doc' : 'docx';
    try {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value || '';
    } catch (error: any) {
      throw new Error(`Failed to parse Word document: ${error.message}`);
    }
  } else if (mimeType?.startsWith('text/') || extension === 'txt' || extension === 'md' || extension === 'text') {
    fileType = 'text';
    text = buffer.toString('utf-8');
  } else {
    text = buffer.toString('utf-8');
    fileType = 'text';
  }

  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  const wordCount = text.split(/\s+/).filter(Boolean).length;

  return {
    text,
    wordCount,
    fileName,
    fileType
  };
}
