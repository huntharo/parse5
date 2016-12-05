import { CODE_POINTS as $ } from '../common/unicode';

//Utils

//OPTIMIZATION: these utility functions should not be moved out of this module. V8 Crankshaft will not inline
//this functions if they will be situated in another module due to context switch.
//Always perform inlining check before modifying this functions ('node --trace-inlining').
function isSurrogatePair(cp1, cp2) {
    return cp1 >= 0xD800 && cp1 <= 0xDBFF && cp2 >= 0xDC00 && cp2 <= 0xDFFF;
}

function getSurrogatePairCodePoint(cp1, cp2) {
    return (cp1 - 0xD800) * 0x400 + 0x2400 + cp2;
}


//Const
const DEFAULT_BUFFER_WATERLINE = 1 << 16;


//Preprocessor
//NOTE: HTML input preprocessing
//(see: http://www.whatwg.org/specs/web-apps/current-work/multipage/parsing.html#preprocessing-the-input-stream)
export default class Preprocessor {
    constructor() {
        this.html = null;

        this.pos = -1;
        this.lastGapPos = -1;
        this.lastCharPos = -1;
        this.droppedBufferSize = 0;

        this.gapStack = [];

        this.skipNextNewLine = false;

        this.lastChunkWritten = false;
        this.endOfChunkHit = false;
        this.bufferWaterline = DEFAULT_BUFFER_WATERLINE;
    }

    get sourcePos() {
        return this.droppedBufferSize + this.pos;
    }

    dropParsedChunk() {
        if (this.pos > this.bufferWaterline) {
            this.lastCharPos -= this.pos;
            this.droppedBufferSize += this.pos;
            this.html = this.html.substring(this.pos);
            this.pos = 0;
            this.lastGapPos = -1;
            this.gapStack = [];
        }
    }

    _addGap() {
        this.gapStack.push(this.lastGapPos);
        this.lastGapPos = this.pos;
    }

    _processHighRangeCodePoint(cp) {
        //NOTE: try to peek a surrogate pair
        if (this.pos !== this.lastCharPos) {
            const nextCp = this.html.charCodeAt(this.pos + 1);

            if (isSurrogatePair(cp, nextCp)) {
                //NOTE: we have a surrogate pair. Peek pair character and recalculate code point.
                this.pos++;
                cp = getSurrogatePairCodePoint(cp, nextCp);

                //NOTE: add gap that should be avoided during retreat
                this._addGap();
            }
        }

        // NOTE: we've hit the end of chunk, stop processing at this point
        else if (!this.lastChunkWritten) {
            this.endOfChunkHit = true;
            return $.EOF;
        }

        return cp;
    }

    write(chunk, isLastChunk) {
        if (this.html)
            this.html += chunk;

        else
            this.html = chunk;

        this.lastCharPos = this.html.length - 1;
        this.endOfChunkHit = false;
        this.lastChunkWritten = isLastChunk;
    }

    insertHtmlAtCurrentPos(chunk) {
        this.html = this.html.substring(0, this.pos + 1) +
                    chunk +
                    this.html.substring(this.pos + 1, this.html.length);

        this.lastCharPos = this.html.length - 1;
        this.endOfChunkHit = false;
    }

    advance() {
        this.pos++;

        if (this.pos > this.lastCharPos) {
            if (!this.lastChunkWritten)
                this.endOfChunkHit = true;

            return $.EOF;
        }

        const cp = this.html.charCodeAt(this.pos);

        //NOTE: any U+000A LINE FEED (LF) characters that immediately follow a U+000D CARRIAGE RETURN (CR) character
        //must be ignored.
        if (this.skipNextNewLine && cp === $.LINE_FEED) {
            this.skipNextNewLine = false;
            this._addGap();
            return this.advance();
        }

        //NOTE: all U+000D CARRIAGE RETURN (CR) characters must be converted to U+000A LINE FEED (LF) characters
        if (cp === $.CARRIAGE_RETURN) {
            this.skipNextNewLine = true;
            return $.LINE_FEED;
        }

        this.skipNextNewLine = false;

        //OPTIMIZATION: first perform check if the code point in the allowed range that covers most common
        //HTML input (e.g. ASCII codes) to avoid performance-cost operations for high-range code points.
        return cp >= 0xD800 ? this._processHighRangeCodePoint(cp) : cp;
    }

    retreat() {
        if (this.pos === this.lastGapPos) {
            this.lastGapPos = this.gapStack.pop();
            this.pos--;
        }

        this.pos--;
    }
}