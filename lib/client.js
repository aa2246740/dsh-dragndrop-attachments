window.__ModuleLoader__.load({
	id: "dsh-dragndrop-attachments",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/wire.ts
		const ATTACHMENT_RPC_CHANNEL = "/dsh-dragndrop-attachments";
		const ENDPOINTS = {
			list: "attachments/list",
			remove: "attachments/remove",
			commitReferences: "attachments/commit-references",
			uploadBegin: "upload/begin",
			folderUploadBegin: "folder-upload/begin",
			uploadChunk: "upload/chunk",
			uploadCommit: "upload/commit",
			uploadCancel: "upload/cancel"
		};
		function isRecord$1(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		//#endregion
		//#region node_modules/.pnpm/fflate@0.8.2/node_modules/fflate/esm/browser.js
		var u8 = Uint8Array;
		var u16 = Uint16Array;
		var i32 = Int32Array;
		var fleb = new u8([
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			1,
			1,
			1,
			1,
			2,
			2,
			2,
			2,
			3,
			3,
			3,
			3,
			4,
			4,
			4,
			4,
			5,
			5,
			5,
			5,
			0,
			0,
			0,
			0
		]);
		var fdeb = new u8([
			0,
			0,
			0,
			0,
			1,
			1,
			2,
			2,
			3,
			3,
			4,
			4,
			5,
			5,
			6,
			6,
			7,
			7,
			8,
			8,
			9,
			9,
			10,
			10,
			11,
			11,
			12,
			12,
			13,
			13,
			0,
			0
		]);
		var clim = new u8([
			16,
			17,
			18,
			0,
			8,
			7,
			9,
			6,
			10,
			5,
			11,
			4,
			12,
			3,
			13,
			2,
			14,
			1,
			15
		]);
		var freb = function(eb, start) {
			var b = new u16(31);
			for (var i = 0; i < 31; ++i) b[i] = start += 1 << eb[i - 1];
			var r = new i32(b[30]);
			for (var i = 1; i < 30; ++i) for (var j = b[i]; j < b[i + 1]; ++j) r[j] = j - b[i] << 5 | i;
			return {
				b,
				r
			};
		};
		var _a = freb(fleb, 2);
		var fl = _a.b;
		var revfl = _a.r;
		fl[28] = 258, revfl[258] = 28;
		var _b = freb(fdeb, 0);
		_b.b;
		var revfd = _b.r;
		var rev = new u16(32768);
		for (var i = 0; i < 32768; ++i) {
			var x = (i & 43690) >> 1 | (i & 21845) << 1;
			x = (x & 52428) >> 2 | (x & 13107) << 2;
			x = (x & 61680) >> 4 | (x & 3855) << 4;
			rev[i] = ((x & 65280) >> 8 | (x & 255) << 8) >> 1;
		}
		var hMap = (function(cd, mb, r) {
			var s = cd.length;
			var i = 0;
			var l = new u16(mb);
			for (; i < s; ++i) if (cd[i]) ++l[cd[i] - 1];
			var le = new u16(mb);
			for (i = 1; i < mb; ++i) le[i] = le[i - 1] + l[i - 1] << 1;
			var co;
			if (r) {
				co = new u16(1 << mb);
				var rvb = 15 - mb;
				for (i = 0; i < s; ++i) if (cd[i]) {
					var sv = i << 4 | cd[i];
					var r_1 = mb - cd[i];
					var v = le[cd[i] - 1]++ << r_1;
					for (var m = v | (1 << r_1) - 1; v <= m; ++v) co[rev[v] >> rvb] = sv;
				}
			} else {
				co = new u16(s);
				for (i = 0; i < s; ++i) if (cd[i]) co[i] = rev[le[cd[i] - 1]++] >> 15 - cd[i];
			}
			return co;
		});
		var flt = new u8(288);
		for (var i = 0; i < 144; ++i) flt[i] = 8;
		for (var i = 144; i < 256; ++i) flt[i] = 9;
		for (var i = 256; i < 280; ++i) flt[i] = 7;
		for (var i = 280; i < 288; ++i) flt[i] = 8;
		var fdt = new u8(32);
		for (var i = 0; i < 32; ++i) fdt[i] = 5;
		var flm = /*#__PURE__*/ hMap(flt, 9, 0);
		var fdm = /*#__PURE__*/ hMap(fdt, 5, 0);
		var shft = function(p) {
			return (p + 7) / 8 | 0;
		};
		var slc = function(v, s, e) {
			if (s == null || s < 0) s = 0;
			if (e == null || e > v.length) e = v.length;
			return new u8(v.subarray(s, e));
		};
		var ec = [
			"unexpected EOF",
			"invalid block type",
			"invalid length/literal",
			"invalid distance",
			"stream finished",
			"no stream handler",
			,
			"no callback",
			"invalid UTF-8 data",
			"extra field too long",
			"date not in range 1980-2099",
			"filename too long",
			"stream finishing",
			"invalid zip data"
		];
		var err = function(ind, msg, nt) {
			var e = new Error(msg || ec[ind]);
			e.code = ind;
			if (Error.captureStackTrace) Error.captureStackTrace(e, err);
			if (!nt) throw e;
			return e;
		};
		var wbits = function(d, p, v) {
			v <<= p & 7;
			var o = p / 8 | 0;
			d[o] |= v;
			d[o + 1] |= v >> 8;
		};
		var wbits16 = function(d, p, v) {
			v <<= p & 7;
			var o = p / 8 | 0;
			d[o] |= v;
			d[o + 1] |= v >> 8;
			d[o + 2] |= v >> 16;
		};
		var hTree = function(d, mb) {
			var t = [];
			for (var i = 0; i < d.length; ++i) if (d[i]) t.push({
				s: i,
				f: d[i]
			});
			var s = t.length;
			var t2 = t.slice();
			if (!s) return {
				t: et,
				l: 0
			};
			if (s == 1) {
				var v = new u8(t[0].s + 1);
				v[t[0].s] = 1;
				return {
					t: v,
					l: 1
				};
			}
			t.sort(function(a, b) {
				return a.f - b.f;
			});
			t.push({
				s: -1,
				f: 25001
			});
			var l = t[0], r = t[1], i0 = 0, i1 = 1, i2 = 2;
			t[0] = {
				s: -1,
				f: l.f + r.f,
				l,
				r
			};
			while (i1 != s - 1) {
				l = t[t[i0].f < t[i2].f ? i0++ : i2++];
				r = t[i0 != i1 && t[i0].f < t[i2].f ? i0++ : i2++];
				t[i1++] = {
					s: -1,
					f: l.f + r.f,
					l,
					r
				};
			}
			var maxSym = t2[0].s;
			for (var i = 1; i < s; ++i) if (t2[i].s > maxSym) maxSym = t2[i].s;
			var tr = new u16(maxSym + 1);
			var mbt = ln(t[i1 - 1], tr, 0);
			if (mbt > mb) {
				var i = 0, dt = 0;
				var lft = mbt - mb, cst = 1 << lft;
				t2.sort(function(a, b) {
					return tr[b.s] - tr[a.s] || a.f - b.f;
				});
				for (; i < s; ++i) {
					var i2_1 = t2[i].s;
					if (tr[i2_1] > mb) {
						dt += cst - (1 << mbt - tr[i2_1]);
						tr[i2_1] = mb;
					} else break;
				}
				dt >>= lft;
				while (dt > 0) {
					var i2_2 = t2[i].s;
					if (tr[i2_2] < mb) dt -= 1 << mb - tr[i2_2]++ - 1;
					else ++i;
				}
				for (; i >= 0 && dt; --i) {
					var i2_3 = t2[i].s;
					if (tr[i2_3] == mb) {
						--tr[i2_3];
						++dt;
					}
				}
				mbt = mb;
			}
			return {
				t: new u8(tr),
				l: mbt
			};
		};
		var ln = function(n, l, d) {
			return n.s == -1 ? Math.max(ln(n.l, l, d + 1), ln(n.r, l, d + 1)) : l[n.s] = d;
		};
		var lc = function(c) {
			var s = c.length;
			while (s && !c[--s]);
			var cl = new u16(++s);
			var cli = 0, cln = c[0], cls = 1;
			var w = function(v) {
				cl[cli++] = v;
			};
			for (var i = 1; i <= s; ++i) if (c[i] == cln && i != s) ++cls;
			else {
				if (!cln && cls > 2) {
					for (; cls > 138; cls -= 138) w(32754);
					if (cls > 2) {
						w(cls > 10 ? cls - 11 << 5 | 28690 : cls - 3 << 5 | 12305);
						cls = 0;
					}
				} else if (cls > 3) {
					w(cln), --cls;
					for (; cls > 6; cls -= 6) w(8304);
					if (cls > 2) w(cls - 3 << 5 | 8208), cls = 0;
				}
				while (cls--) w(cln);
				cls = 1;
				cln = c[i];
			}
			return {
				c: cl.subarray(0, cli),
				n: s
			};
		};
		var clen = function(cf, cl) {
			var l = 0;
			for (var i = 0; i < cl.length; ++i) l += cf[i] * cl[i];
			return l;
		};
		var wfblk = function(out, pos, dat) {
			var s = dat.length;
			var o = shft(pos + 2);
			out[o] = s & 255;
			out[o + 1] = s >> 8;
			out[o + 2] = out[o] ^ 255;
			out[o + 3] = out[o + 1] ^ 255;
			for (var i = 0; i < s; ++i) out[o + i + 4] = dat[i];
			return (o + 4 + s) * 8;
		};
		var wblk = function(dat, out, final, syms, lf, df, eb, li, bs, bl, p) {
			wbits(out, p++, final);
			++lf[256];
			var _a = hTree(lf, 15), dlt = _a.t, mlb = _a.l;
			var _b = hTree(df, 15), ddt = _b.t, mdb = _b.l;
			var _c = lc(dlt), lclt = _c.c, nlc = _c.n;
			var _d = lc(ddt), lcdt = _d.c, ndc = _d.n;
			var lcfreq = new u16(19);
			for (var i = 0; i < lclt.length; ++i) ++lcfreq[lclt[i] & 31];
			for (var i = 0; i < lcdt.length; ++i) ++lcfreq[lcdt[i] & 31];
			var _e = hTree(lcfreq, 7), lct = _e.t, mlcb = _e.l;
			var nlcc = 19;
			for (; nlcc > 4 && !lct[clim[nlcc - 1]]; --nlcc);
			var flen = bl + 5 << 3;
			var ftlen = clen(lf, flt) + clen(df, fdt) + eb;
			var dtlen = clen(lf, dlt) + clen(df, ddt) + eb + 14 + 3 * nlcc + clen(lcfreq, lct) + 2 * lcfreq[16] + 3 * lcfreq[17] + 7 * lcfreq[18];
			if (bs >= 0 && flen <= ftlen && flen <= dtlen) return wfblk(out, p, dat.subarray(bs, bs + bl));
			var lm, ll, dm, dl;
			wbits(out, p, 1 + (dtlen < ftlen)), p += 2;
			if (dtlen < ftlen) {
				lm = hMap(dlt, mlb, 0), ll = dlt, dm = hMap(ddt, mdb, 0), dl = ddt;
				var llm = hMap(lct, mlcb, 0);
				wbits(out, p, nlc - 257);
				wbits(out, p + 5, ndc - 1);
				wbits(out, p + 10, nlcc - 4);
				p += 14;
				for (var i = 0; i < nlcc; ++i) wbits(out, p + 3 * i, lct[clim[i]]);
				p += 3 * nlcc;
				var lcts = [lclt, lcdt];
				for (var it = 0; it < 2; ++it) {
					var clct = lcts[it];
					for (var i = 0; i < clct.length; ++i) {
						var len = clct[i] & 31;
						wbits(out, p, llm[len]), p += lct[len];
						if (len > 15) wbits(out, p, clct[i] >> 5 & 127), p += clct[i] >> 12;
					}
				}
			} else lm = flm, ll = flt, dm = fdm, dl = fdt;
			for (var i = 0; i < li; ++i) {
				var sym = syms[i];
				if (sym > 255) {
					var len = sym >> 18 & 31;
					wbits16(out, p, lm[len + 257]), p += ll[len + 257];
					if (len > 7) wbits(out, p, sym >> 23 & 31), p += fleb[len];
					var dst = sym & 31;
					wbits16(out, p, dm[dst]), p += dl[dst];
					if (dst > 3) wbits16(out, p, sym >> 5 & 8191), p += fdeb[dst];
				} else wbits16(out, p, lm[sym]), p += ll[sym];
			}
			wbits16(out, p, lm[256]);
			return p + ll[256];
		};
		var deo = /*#__PURE__*/ new i32([
			65540,
			131080,
			131088,
			131104,
			262176,
			1048704,
			1048832,
			2114560,
			2117632
		]);
		var et = /*#__PURE__*/ new u8(0);
		var dflt = function(dat, lvl, plvl, pre, post, st) {
			var s = st.z || dat.length;
			var o = new u8(pre + s + 5 * (1 + Math.ceil(s / 7e3)) + post);
			var w = o.subarray(pre, o.length - post);
			var lst = st.l;
			var pos = (st.r || 0) & 7;
			if (lvl) {
				if (pos) w[0] = st.r >> 3;
				var opt = deo[lvl - 1];
				var n = opt >> 13, c = opt & 8191;
				var msk_1 = (1 << plvl) - 1;
				var prev = st.p || new u16(32768), head = st.h || new u16(msk_1 + 1);
				var bs1_1 = Math.ceil(plvl / 3), bs2_1 = 2 * bs1_1;
				var hsh = function(i) {
					return (dat[i] ^ dat[i + 1] << bs1_1 ^ dat[i + 2] << bs2_1) & msk_1;
				};
				var syms = new i32(25e3);
				var lf = new u16(288), df = new u16(32);
				var lc_1 = 0, eb = 0, i = st.i || 0, li = 0, wi = st.w || 0, bs = 0;
				for (; i + 2 < s; ++i) {
					var hv = hsh(i);
					var imod = i & 32767, pimod = head[hv];
					prev[imod] = pimod;
					head[hv] = imod;
					if (wi <= i) {
						var rem = s - i;
						if ((lc_1 > 7e3 || li > 24576) && (rem > 423 || !lst)) {
							pos = wblk(dat, w, 0, syms, lf, df, eb, li, bs, i - bs, pos);
							li = lc_1 = eb = 0, bs = i;
							for (var j = 0; j < 286; ++j) lf[j] = 0;
							for (var j = 0; j < 30; ++j) df[j] = 0;
						}
						var l = 2, d = 0, ch_1 = c, dif = imod - pimod & 32767;
						if (rem > 2 && hv == hsh(i - dif)) {
							var maxn = Math.min(n, rem) - 1;
							var maxd = Math.min(32767, i);
							var ml = Math.min(258, rem);
							while (dif <= maxd && --ch_1 && imod != pimod) {
								if (dat[i + l] == dat[i + l - dif]) {
									var nl = 0;
									for (; nl < ml && dat[i + nl] == dat[i + nl - dif]; ++nl);
									if (nl > l) {
										l = nl, d = dif;
										if (nl > maxn) break;
										var mmd = Math.min(dif, nl - 2);
										var md = 0;
										for (var j = 0; j < mmd; ++j) {
											var ti = i - dif + j & 32767;
											var cd = ti - prev[ti] & 32767;
											if (cd > md) md = cd, pimod = ti;
										}
									}
								}
								imod = pimod, pimod = prev[imod];
								dif += imod - pimod & 32767;
							}
						}
						if (d) {
							syms[li++] = 268435456 | revfl[l] << 18 | revfd[d];
							var lin = revfl[l] & 31, din = revfd[d] & 31;
							eb += fleb[lin] + fdeb[din];
							++lf[257 + lin];
							++df[din];
							wi = i + l;
							++lc_1;
						} else {
							syms[li++] = dat[i];
							++lf[dat[i]];
						}
					}
				}
				for (i = Math.max(i, wi); i < s; ++i) {
					syms[li++] = dat[i];
					++lf[dat[i]];
				}
				pos = wblk(dat, w, lst, syms, lf, df, eb, li, bs, i - bs, pos);
				if (!lst) {
					st.r = pos & 7 | w[pos / 8 | 0] << 3;
					pos -= 7;
					st.h = head, st.p = prev, st.i = i, st.w = wi;
				}
			} else {
				for (var i = st.w || 0; i < s + lst; i += 65535) {
					var e = i + 65535;
					if (e >= s) {
						w[pos / 8 | 0] = lst;
						e = s;
					}
					pos = wfblk(w, pos + 1, dat.subarray(i, e));
				}
				st.i = s;
			}
			return slc(o, 0, pre + shft(pos) + post);
		};
		var crct = /*#__PURE__*/ (function() {
			var t = /* @__PURE__ */ new Int32Array(256);
			for (var i = 0; i < 256; ++i) {
				var c = i, k = 9;
				while (--k) c = (c & 1 && -306674912) ^ c >>> 1;
				t[i] = c;
			}
			return t;
		})();
		var crc = function() {
			var c = -1;
			return {
				p: function(d) {
					var cr = c;
					for (var i = 0; i < d.length; ++i) cr = crct[cr & 255 ^ d[i]] ^ cr >>> 8;
					c = cr;
				},
				d: function() {
					return ~c;
				}
			};
		};
		var dopt = function(dat, opt, pre, post, st) {
			if (!st) {
				st = { l: 1 };
				if (opt.dictionary) {
					var dict = opt.dictionary.subarray(-32768);
					var newDat = new u8(dict.length + dat.length);
					newDat.set(dict);
					newDat.set(dat, dict.length);
					dat = newDat;
					st.w = dict.length;
				}
			}
			return dflt(dat, opt.level == null ? 6 : opt.level, opt.mem == null ? st.l ? Math.ceil(Math.max(8, Math.min(13, Math.log(dat.length))) * 1.5) : 20 : 12 + opt.mem, pre, post, st);
		};
		var mrg = function(a, b) {
			var o = {};
			for (var k in a) o[k] = a[k];
			for (var k in b) o[k] = b[k];
			return o;
		};
		var wbytes = function(d, b, v) {
			for (; v; ++b) d[b] = v, v >>>= 8;
		};
		/**
		* Compresses data with DEFLATE without any wrapper
		* @param data The data to compress
		* @param opts The compression options
		* @returns The deflated version of the data
		*/
		function deflateSync(data, opts) {
			return dopt(data, opts || {}, 0, 0);
		}
		var fltn = function(d, p, t, o) {
			for (var k in d) {
				var val = d[k], n = p + k, op = o;
				if (Array.isArray(val)) op = mrg(o, val[1]), val = val[0];
				if (val instanceof u8) t[n] = [val, op];
				else {
					t[n += "/"] = [new u8(0), op];
					fltn(val, n, t, o);
				}
			}
		};
		var te = typeof TextEncoder != "undefined" && /*#__PURE__*/ new TextEncoder();
		var td = typeof TextDecoder != "undefined" && /*#__PURE__*/ new TextDecoder();
		try {
			td.decode(et, { stream: true });
		} catch (e) {}
		/**
		* Converts a string into a Uint8Array for use with compression/decompression methods
		* @param str The string to encode
		* @param latin1 Whether or not to interpret the data as Latin-1. This should
		*               not need to be true unless decoding a binary string.
		* @returns The string encoded in UTF-8/Latin-1 binary
		*/
		function strToU8(str, latin1) {
			if (latin1) {
				var ar_1 = new u8(str.length);
				for (var i = 0; i < str.length; ++i) ar_1[i] = str.charCodeAt(i);
				return ar_1;
			}
			if (te) return te.encode(str);
			var l = str.length;
			var ar = new u8(str.length + (str.length >> 1));
			var ai = 0;
			var w = function(v) {
				ar[ai++] = v;
			};
			for (var i = 0; i < l; ++i) {
				if (ai + 5 > ar.length) {
					var n = new u8(ai + 8 + (l - i << 1));
					n.set(ar);
					ar = n;
				}
				var c = str.charCodeAt(i);
				if (c < 128 || latin1) w(c);
				else if (c < 2048) w(192 | c >> 6), w(128 | c & 63);
				else if (c > 55295 && c < 57344) c = 65536 + (c & 1047552) | str.charCodeAt(++i) & 1023, w(240 | c >> 18), w(128 | c >> 12 & 63), w(128 | c >> 6 & 63), w(128 | c & 63);
				else w(224 | c >> 12), w(128 | c >> 6 & 63), w(128 | c & 63);
			}
			return slc(ar, 0, ai);
		}
		var exfl = function(ex) {
			var le = 0;
			if (ex) for (var k in ex) {
				var l = ex[k].length;
				if (l > 65535) err(9);
				le += l + 4;
			}
			return le;
		};
		var wzh = function(d, b, f, fn, u, c, ce, co) {
			var fl = fn.length, ex = f.extra, col = co && co.length;
			var exl = exfl(ex);
			wbytes(d, b, ce != null ? 33639248 : 67324752), b += 4;
			if (ce != null) d[b++] = 20, d[b++] = f.os;
			d[b] = 20, b += 2;
			d[b++] = f.flag << 1 | (c < 0 && 8), d[b++] = u && 8;
			d[b++] = f.compression & 255, d[b++] = f.compression >> 8;
			var dt = new Date(f.mtime == null ? Date.now() : f.mtime), y = dt.getFullYear() - 1980;
			if (y < 0 || y > 119) err(10);
			wbytes(d, b, y << 25 | dt.getMonth() + 1 << 21 | dt.getDate() << 16 | dt.getHours() << 11 | dt.getMinutes() << 5 | dt.getSeconds() >> 1), b += 4;
			if (c != -1) {
				wbytes(d, b, f.crc);
				wbytes(d, b + 4, c < 0 ? -c - 2 : c);
				wbytes(d, b + 8, f.size);
			}
			wbytes(d, b + 12, fl);
			wbytes(d, b + 14, exl), b += 16;
			if (ce != null) {
				wbytes(d, b, col);
				wbytes(d, b + 6, f.attrs);
				wbytes(d, b + 10, ce), b += 14;
			}
			d.set(fn, b);
			b += fl;
			if (exl) for (var k in ex) {
				var exf = ex[k], l = exf.length;
				wbytes(d, b, +k);
				wbytes(d, b + 2, l);
				d.set(exf, b + 4), b += 4 + l;
			}
			if (col) d.set(co, b), b += col;
			return b;
		};
		var wzf = function(o, b, c, d, e) {
			wbytes(o, b, 101010256);
			wbytes(o, b + 8, c);
			wbytes(o, b + 10, c);
			wbytes(o, b + 12, d);
			wbytes(o, b + 16, e);
		};
		/**
		* Synchronously creates a ZIP file. Prefer using `zip` for better performance
		* with more than one file.
		* @param data The directory structure for the ZIP archive
		* @param opts The main options, merged with per-file options
		* @returns The generated ZIP archive
		*/
		function zipSync(data, opts) {
			if (!opts) opts = {};
			var r = {};
			var files = [];
			fltn(data, "", r, opts);
			var o = 0;
			var tot = 0;
			for (var fn in r) {
				var _a = r[fn], file = _a[0], p = _a[1];
				var compression = p.level == 0 ? 0 : 8;
				var f = strToU8(fn), s = f.length;
				var com = p.comment, m = com && strToU8(com), ms = m && m.length;
				var exl = exfl(p.extra);
				if (s > 65535) err(11);
				var d = compression ? deflateSync(file, p) : file, l = d.length;
				var c = crc();
				c.p(file);
				files.push(mrg(p, {
					size: file.length,
					crc: c.d(),
					c: d,
					f,
					m,
					u: s != fn.length || m && com.length != ms,
					o,
					compression
				}));
				o += 30 + s + exl + l;
				tot += 76 + 2 * (s + exl) + (ms || 0) + l;
			}
			var out = new u8(tot + 22), oe = o, cdl = tot - o;
			for (var i = 0; i < files.length; ++i) {
				var f = files[i];
				wzh(out, f.o, f, f.f, f.u, f.c.length);
				var badd = 30 + f.f.length + exfl(f.extra);
				out.set(f.c, f.o + badd);
				wzh(out, o, f, f.f, f.u, f.c.length, f.o, f.m), o += 16 + badd + (f.m ? f.m.length : 0);
			}
			wzf(out, o, files.length, cdl, oe);
			return out;
		}
		const FIXED_ZIP_TIME = new Date(Date.UTC(1980, 0, 1));
		function isRecord(value) {
			return typeof value === "object" && value !== null && !Array.isArray(value);
		}
		function normalizeFolderPath(raw, directory = false) {
			const normalized = raw.normalize("NFC");
			if (normalized.includes("\0") || normalized.includes("\\") || normalized.startsWith("/") || normalized.startsWith("//") || /^[A-Za-z]:[\\/]/u.test(normalized)) throw new Error(`文件夹包含不安全路径：${raw}`);
			const body = directory && normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
			const parts = body.split("/");
			if (new TextEncoder().encode(normalized).byteLength > 4096 || body === "" || parts.some((part) => part === "" || part === "." || part === ".." || /[\u0000-\u001f\u007f]/u.test(part) || new TextEncoder().encode(part).byteLength > 255)) throw new Error(`文件夹包含不安全路径：${raw}`);
			return `${parts.join("/")}${directory ? "/" : ""}`;
		}
		function rootName(raw) {
			const name = raw.replace(/[\\/\u0000-\u001f\u007f]/gu, "").trim();
			if (name === "") throw new Error("文件夹名称不能为空。");
			return name.slice(0, 255);
		}
		function parentDirectories(path) {
			const parts = path.split("/");
			const result = [];
			for (let index = 1; index < parts.length; index++) result.push(`${parts.slice(0, index).join("/")}/`);
			return result;
		}
		function stripRootPath(root, path) {
			const prefix = `${root}/`;
			if (!path.startsWith(prefix)) throw new Error("浏览器目录根路径不一致。");
			return path.slice(prefix.length);
		}
		function withoutRoot(entries, root) {
			return entries.flatMap((entry) => entry.kind === "directory" && entry.path === `${root}/` ? [] : [entry.kind === "directory" ? {
				kind: "directory",
				path: stripRootPath(root, entry.path)
			} : {
				kind: "file",
				path: stripRootPath(root, entry.path),
				file: entry.file
			}]);
		}
		function validateFolderEntries(rawEntries) {
			const paths = /* @__PURE__ */ new Set();
			const files = /* @__PURE__ */ new Set();
			const directories = /* @__PURE__ */ new Set();
			const entries = rawEntries.map((entry) => entry.kind === "directory" ? {
				kind: "directory",
				path: normalizeFolderPath(entry.path, true)
			} : {
				kind: "file",
				path: normalizeFolderPath(entry.path),
				file: entry.file
			});
			for (const entry of entries) {
				if (paths.has(entry.path)) throw new Error(`文件夹包含重复路径：${entry.path}`);
				paths.add(entry.path);
				if (entry.kind === "directory") directories.add(entry.path.slice(0, -1));
				else files.add(entry.path);
			}
			for (const file of files) for (const parent of parentDirectories(file)) if (files.has(parent.slice(0, -1))) throw new Error(`文件和目录路径冲突：${parent}`);
			for (const directory of directories) if (files.has(directory)) throw new Error(`文件和目录路径冲突：${directory}`);
			return entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
		}
		async function encodeFolderSnapshot(item) {
			const name = rootName(item.name);
			const entries = validateFolderEntries(item.entries);
			const files = entries.filter((entry) => entry.kind === "file");
			const directories = entries.filter((entry) => entry.kind === "directory");
			const sourceBytes = files.reduce((sum, entry) => sum + entry.file.size, 0);
			if (files.length > 1e4 || entries.length > 1e4 || sourceBytes > 104857600) throw new Error("文件夹超过本地附件安全上限。");
			const payload = {};
			for (const entry of directories) payload[entry.path] = [/* @__PURE__ */ new Uint8Array(), {
				level: 0,
				mtime: FIXED_ZIP_TIME,
				attrs: 16877 << 16
			}];
			for (const entry of files) payload[entry.path] = [new Uint8Array(await entry.file.arrayBuffer()), {
				level: 0,
				mtime: FIXED_ZIP_TIME,
				attrs: 33188 << 16
			}];
			const snapshot = zipSync(payload, {
				level: 0,
				mtime: FIXED_ZIP_TIME,
				os: 3
			});
			if (snapshot.byteLength > 134217728) throw new Error("文件夹快照超过 128 MiB 上限。");
			return {
				kind: "folder",
				name,
				sourceBytes,
				fileCount: files.length,
				directoryCount: directories.length,
				snapshot,
				emptyDirectories: item.emptyDirectories
			};
		}
		function hasFunction(value, name) {
			return typeof value[name] === "function";
		}
		function call(value, name, args) {
			const member = value[name];
			if (typeof member !== "function") throw new Error(`浏览器目录 API ${name} 不可用。`);
			return Reflect.apply(member, value, args);
		}
		function isAsyncIterable(value) {
			return isRecord(value) && typeof Reflect.get(value, Symbol.asyncIterator) === "function";
		}
		function asFile(value) {
			if (!(value instanceof File)) throw new Error("浏览器目录条目不是文件。");
			return value;
		}
		async function handleToEntries(handle, prefix) {
			if (!isRecord(handle) || typeof handle.kind !== "string" || typeof handle.name !== "string") throw new Error("浏览器目录句柄无效。");
			const path = prefix === "" ? handle.name : `${prefix}/${handle.name}`;
			if (handle.kind === "file") {
				if (!hasFunction(handle, "getFile")) throw new Error("浏览器文件句柄无效。");
				return [{
					kind: "file",
					path: normalizeFolderPath(path),
					file: asFile(await call(handle, "getFile", []))
				}];
			}
			if (handle.kind !== "directory" || !hasFunction(handle, "values")) throw new Error("浏览器目录句柄无效。");
			const iterator = call(handle, "values", []);
			if (!isAsyncIterable(iterator)) throw new Error("浏览器目录遍历不可用。");
			const children = [{
				kind: "directory",
				path: normalizeFolderPath(path, true)
			}];
			for await (const child of iterator) children.push(...await handleToEntries(child, path));
			return children;
		}
		function readerBatch(reader) {
			if (!hasFunction(reader, "readEntries")) throw new Error("浏览器目录读取器无效。");
			return new Promise((resolve, reject) => {
				call(reader, "readEntries", [resolve, reject]);
			});
		}
		async function entryToEntries(entry, prefix) {
			if (!isRecord(entry) || typeof entry.name !== "string") throw new Error("浏览器目录条目无效。");
			const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
			if (entry.isFile === true) {
				if (!hasFunction(entry, "file")) throw new Error("浏览器文件条目无效。");
				const file = await new Promise((resolve, reject) => {
					call(entry, "file", [resolve, reject]);
				});
				return [{
					kind: "file",
					path: normalizeFolderPath(path),
					file
				}];
			}
			if (entry.isDirectory !== true || !hasFunction(entry, "createReader")) throw new Error("浏览器目录条目无效。");
			const reader = call(entry, "createReader", []);
			if (!isRecord(reader)) throw new Error("浏览器目录读取器无效。");
			const children = [{
				kind: "directory",
				path: normalizeFolderPath(path, true)
			}];
			for (;;) {
				const batch = await readerBatch(reader);
				if (batch.length === 0) break;
				for (const child of batch) children.push(...await entryToEntries(child, path));
			}
			return children;
		}
		function fileItem(file) {
			return {
				kind: "file",
				file
			};
		}
		function entryFromRelativeFiles(files) {
			const groups = /* @__PURE__ */ new Map();
			const plain = [];
			for (const file of files) {
				const candidate = file;
				const relative = isRecord(candidate) && typeof candidate.webkitRelativePath === "string" ? candidate.webkitRelativePath : "";
				if (relative === "") {
					plain.push(fileItem(file));
					continue;
				}
				const segments = relative.replaceAll("\\", "/").split("/");
				const root = rootName(segments.shift() ?? "");
				const path = normalizeFolderPath(segments.join("/"));
				const entries = groups.get(root) ?? [];
				for (const parent of parentDirectories(path)) if (!entries.some((entry) => entry.kind === "directory" && entry.path === parent)) entries.push({
					kind: "directory",
					path: parent
				});
				entries.push({
					kind: "file",
					path,
					file
				});
				groups.set(root, entries);
			}
			return [...plain, ...[...groups.entries()].map(([name, entries]) => ({
				kind: "folder",
				name,
				entries: validateFolderEntries(entries),
				emptyDirectories: "unavailable"
			}))];
		}
		function snapshotDropItem(item) {
			const candidate = item;
			let modern;
			let legacy;
			let file = null;
			if (isRecord(candidate) && hasFunction(candidate, "getAsFileSystemHandle")) try {
				modern = Promise.resolve(call(candidate, "getAsFileSystemHandle", [])).catch(() => void 0);
			} catch {}
			if (isRecord(candidate) && hasFunction(candidate, "webkitGetAsEntry")) try {
				legacy = call(candidate, "webkitGetAsEntry", []);
			} catch {}
			try {
				file = item.getAsFile();
			} catch {}
			return {
				modern,
				legacy,
				file
			};
		}
		async function itemFromSnapshot(snapshot) {
			if (snapshot.modern !== void 0) {
				const handle = await snapshot.modern.catch(() => void 0);
				if (isRecord(handle) && handle.kind === "directory") {
					const entries = await handleToEntries(handle, "");
					const root = rootName(String(handle.name));
					return {
						kind: "folder",
						name: root,
						entries: validateFolderEntries(withoutRoot(entries, root)),
						emptyDirectories: "preserved"
					};
				}
				if (isRecord(handle) && handle.kind === "file" && hasFunction(handle, "getFile")) return fileItem(asFile(await call(handle, "getFile", [])));
			}
			if (snapshot.legacy !== void 0) {
				const entry = snapshot.legacy;
				if (isRecord(entry) && entry.isDirectory === true) {
					const entries = await entryToEntries(entry, "");
					const root = rootName(String(entry.name));
					return {
						kind: "folder",
						name: root,
						entries: validateFolderEntries(withoutRoot(entries, root)),
						emptyDirectories: "preserved"
					};
				}
				if (isRecord(entry) && entry.isFile === true) {
					const first = (await entryToEntries(entry, ""))[0];
					if (first?.kind === "file") return fileItem(first.file);
				}
			}
			const file = snapshot.file;
			return file === null ? void 0 : fileItem(file);
		}
		function snapshotDroppedItems(dataTransfer) {
			return {
				items: dataTransfer.items === void 0 ? [] : [...dataTransfer.items].map(snapshotDropItem),
				files: [...dataTransfer.files]
			};
		}
		async function collectDroppedItems(snapshot) {
			if (snapshot.items.length > 0) {
				const items = (await Promise.all(snapshot.items.map(itemFromSnapshot))).filter((value) => value !== void 0);
				if (items.length > 0) return items;
			}
			return entryFromRelativeFiles(snapshot.files);
		}
		function supportsModernDirectoryPicker() {
			const candidate = window;
			return isRecord(candidate) && hasFunction(candidate, "showDirectoryPicker");
		}
		async function collectPickedDirectory() {
			const candidate = window;
			if (supportsModernDirectoryPicker() && isRecord(candidate)) {
				const handle = await call(candidate, "showDirectoryPicker", []);
				if (!isRecord(handle) || handle.kind !== "directory" || typeof handle.name !== "string") throw new Error("文件夹选择器没有返回目录。");
				const entries = await handleToEntries(handle, "");
				const root = rootName(handle.name);
				return {
					kind: "folder",
					name: root,
					entries: validateFolderEntries(withoutRoot(entries, root)),
					emptyDirectories: "preserved"
				};
			}
			throw new Error("此浏览器不支持保留空目录的文件夹选择器。");
		}
		function collectWebkitDirectory(files) {
			return entryFromRelativeFiles(files);
		}
		//#endregion
		//#region src/client/image.ts
		const MAX_NATIVE_DIMENSION = 2e3;
		const MAX_PATCHES = 2500;
		const PATCH_SIZE = 32;
		const MAX_NATIVE_BYTES = Math.floor(3.4 * 1024 * 1024);
		function ascii(data, offset, length) {
			return String.fromCharCode(...data.subarray(offset, offset + length));
		}
		function uint24le(data, offset) {
			return (data[offset] ?? 0) | (data[offset + 1] ?? 0) << 8 | (data[offset + 2] ?? 0) << 16;
		}
		function pngDimensions(data) {
			if (data.length < 24 || ascii(data, 1, 3) !== "PNG") return void 0;
			const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
			return {
				width: view.getUint32(16),
				height: view.getUint32(20)
			};
		}
		function gifDimensions(data) {
			if (data.length < 10 || ascii(data, 0, 6) !== "GIF87a" && ascii(data, 0, 6) !== "GIF89a") return void 0;
			const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
			return {
				width: view.getUint16(6, true),
				height: view.getUint16(8, true)
			};
		}
		function jpegDimensions(data) {
			if (data.length < 4 || data[0] !== 255 || data[1] !== 216) return void 0;
			const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
			let offset = 2;
			while (offset + 9 < data.length) {
				if (data[offset] !== 255) {
					offset += 1;
					continue;
				}
				const marker = data[offset + 1] ?? 0;
				if (marker === 216 || marker === 217) {
					offset += 2;
					continue;
				}
				const length = view.getUint16(offset + 2);
				if (length < 2 || offset + 2 + length > data.length) return void 0;
				if (marker >= 192 && marker <= 195 || marker >= 197 && marker <= 199 || marker >= 201 && marker <= 203 || marker >= 205 && marker <= 207) return {
					height: view.getUint16(offset + 5),
					width: view.getUint16(offset + 7)
				};
				offset += 2 + length;
			}
		}
		function webpDimensions(data) {
			if (data.length < 30 || ascii(data, 0, 4) !== "RIFF" || ascii(data, 8, 4) !== "WEBP") return void 0;
			const kind = ascii(data, 12, 4);
			if (kind === "VP8X") return {
				width: uint24le(data, 24) + 1,
				height: uint24le(data, 27) + 1
			};
			if (kind === "VP8L" && data[20] === 47) {
				const b1 = data[21] ?? 0;
				const b2 = data[22] ?? 0;
				const b3 = data[23] ?? 0;
				const b4 = data[24] ?? 0;
				return {
					width: 1 + b1 + ((b2 & 63) << 8),
					height: 1 + ((b2 & 192) >> 6) + (b3 << 2) + ((b4 & 15) << 10)
				};
			}
			if (kind === "VP8 " && data[23] === 157 && data[24] === 1 && data[25] === 42) {
				const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
				return {
					width: view.getUint16(26, true) & 16383,
					height: view.getUint16(28, true) & 16383
				};
			}
		}
		function outputDimensions(sourceWidth, sourceHeight) {
			const originalWidth = Math.max(1, sourceWidth);
			const originalHeight = Math.max(1, sourceHeight);
			const fits = (width, height) => width <= MAX_NATIVE_DIMENSION && height <= MAX_NATIVE_DIMENSION && Math.ceil(width / PATCH_SIZE) * Math.ceil(height / PATCH_SIZE) <= MAX_PATCHES;
			if (fits(originalWidth, originalHeight)) return {
				width: originalWidth,
				height: originalHeight
			};
			const sideScale = Math.min(1, MAX_NATIVE_DIMENSION / Math.max(originalWidth, originalHeight));
			const width = Math.max(1, Math.round(originalWidth * sideScale));
			const height = Math.max(1, Math.round(originalHeight * sideScale));
			if (fits(width, height)) return {
				width,
				height
			};
			let scale = Math.sqrt(PATCH_SIZE * PATCH_SIZE * MAX_PATCHES / width / height);
			const patchesWide = width * scale / PATCH_SIZE;
			const patchesHigh = height * scale / PATCH_SIZE;
			scale *= Math.min(Math.floor(patchesWide) / patchesWide, Math.floor(patchesHigh) / patchesHigh);
			return {
				width: Math.max(1, Math.floor(width * scale)),
				height: Math.max(1, Math.floor(height * scale))
			};
		}
		async function probe(file) {
			const header = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
			const parsed = pngDimensions(header) ?? gifDimensions(header) ?? jpegDimensions(header) ?? webpDimensions(header);
			if (parsed !== void 0 && parsed.width > 0 && parsed.height > 0) return parsed;
			const bitmap = await createImageBitmap(file);
			try {
				return {
					width: bitmap.width,
					height: bitmap.height
				};
			} finally {
				bitmap.close();
			}
		}
		function canvasBlob(canvas, type, quality) {
			return new Promise((resolve, reject) => canvas.toBlob((blob) => {
				if (blob === null) reject(/* @__PURE__ */ new Error("浏览器无法编码图片。"));
				else resolve(blob);
			}, type, quality));
		}
		async function encode(canvas, sourceType) {
			const preferred = sourceType === "image/jpeg" ? "image/jpeg" : "image/webp";
			let latest;
			for (const quality of [
				.92,
				.86,
				.8,
				.72,
				.64
			]) {
				latest = await canvasBlob(canvas, preferred, quality);
				if (latest.size <= MAX_NATIVE_BYTES) return latest;
			}
			if (preferred !== "image/jpeg") for (const quality of [
				.8,
				.7,
				.6
			]) {
				latest = await canvasBlob(canvas, "image/jpeg", quality);
				if (latest.size <= MAX_NATIVE_BYTES) return latest;
			}
			throw new Error(`图片压缩后仍超过 ${Math.round(MAX_NATIVE_BYTES / 1024 / 1024 * 10) / 10} MiB。`);
		}
		async function prepareImage(file) {
			const source = await probe(file);
			const output = outputDimensions(source.width, source.height);
			const normalizedType = file.type === "image/jpg" ? "image/jpeg" : file.type;
			if ((normalizedType === "image/png" || normalizedType === "image/jpeg" || normalizedType === "image/webp") && file.size <= MAX_NATIVE_BYTES && output.width === source.width && output.height === source.height) return {
				file,
				source,
				output,
				resized: false
			};
			const bitmap = await createImageBitmap(file, {
				resizeWidth: output.width,
				resizeHeight: output.height,
				resizeQuality: "high",
				imageOrientation: "from-image"
			});
			try {
				const canvas = document.createElement("canvas");
				canvas.width = output.width;
				canvas.height = output.height;
				const context = canvas.getContext("2d", { alpha: true });
				if (context === null) throw new Error("浏览器无法创建图片画布。");
				context.drawImage(bitmap, 0, 0, output.width, output.height);
				const blob = await encode(canvas, normalizedType);
				return {
					file: new File([blob], file.name, {
						type: blob.type,
						lastModified: file.lastModified
					}),
					source,
					output,
					resized: true
				};
			} finally {
				bitmap.close();
			}
		}
		function isImageFile(file) {
			return /^(image\/(png|jpeg|jpg|webp|gif))$/u.test(file.type) || /\.(png|jpe?g|webp|gif)$/iu.test(file.name);
		}
		//#endregion
		//#region src/client/transfers.ts
		function bindFileIntake(documentTarget, windowTarget, onItems, onDragActive, onError) {
			let dragDepth = 0;
			let intakeChain = Promise.resolve();
			const enqueue = (work) => {
				intakeChain = intakeChain.then(work).catch(onError);
			};
			const fileTransfer = (event) => {
				const transfer = event.dataTransfer;
				return transfer !== null && transfer !== void 0 && Array.from(transfer.types).includes("Files") ? transfer : null;
			};
			const reset = () => {
				dragDepth = 0;
				onDragActive(false);
			};
			const enter = (event) => {
				if (fileTransfer(event) === null) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				dragDepth += 1;
				onDragActive(true);
			};
			const over = (event) => {
				const transfer = fileTransfer(event);
				if (transfer === null) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				transfer.dropEffect = "copy";
				onDragActive(true);
			};
			const leave = (event) => {
				if (fileTransfer(event) === null) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				dragDepth = Math.max(0, dragDepth - 1);
				if (dragDepth === 0) onDragActive(false);
			};
			const drop = (event) => {
				const transfer = fileTransfer(event);
				if (transfer === null) return;
				const snapshot = snapshotDroppedItems(transfer);
				event.preventDefault();
				event.stopImmediatePropagation();
				reset();
				enqueue(async () => {
					await onItems(await collectDroppedItems(snapshot));
				});
			};
			const paste = (event) => {
				const files = Array.from(event.clipboardData?.files ?? []);
				if (files.length === 0) return;
				event.preventDefault();
				event.stopImmediatePropagation();
				enqueue(async () => {
					await onItems(files.map((file) => ({
						kind: "file",
						file
					})));
				});
			};
			documentTarget.addEventListener("dragenter", enter, true);
			documentTarget.addEventListener("dragover", over, true);
			documentTarget.addEventListener("dragleave", leave, true);
			documentTarget.addEventListener("drop", drop, true);
			documentTarget.addEventListener("paste", paste, true);
			windowTarget.addEventListener("dragend", reset);
			return () => {
				documentTarget.removeEventListener("dragenter", enter, true);
				documentTarget.removeEventListener("dragover", over, true);
				documentTarget.removeEventListener("dragleave", leave, true);
				documentTarget.removeEventListener("drop", drop, true);
				documentTarget.removeEventListener("paste", paste, true);
				windowTarget.removeEventListener("dragend", reset);
			};
		}
		//#endregion
		//#region \0dshx-css-module:./src/client/AttachmentDock.module.css.mjs
		const css = ".QmyFfG_dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - 4 * var(--dsh-composer-dock-inset));flex-direction:column;flex:none;gap:8px;margin:0 auto;display:flex}.QmyFfG_hidden{display:none}.QmyFfG_rail{flex-wrap:wrap;gap:8px;display:flex}.QmyFfG_card{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1,#d0d5dd);background:var(--dsw-specific-tip,#fff);border-radius:10px;width:min(100%,360px);padding:9px 10px;box-shadow:0 1px 2px #1018280a}.QmyFfG_cardTop{align-items:flex-start;gap:8px;display:flex}.QmyFfG_icon{background:var(--dsw-alias-interactive-bg-hover,#f2f4f7);width:32px;height:28px;color:var(--dsw-alias-label-secondary,#667085);letter-spacing:-.02em;border-radius:7px;flex:none;place-items:center;font:700 9px/1 ui-monospace,SFMono-Regular,Menlo,monospace;display:grid}.QmyFfG_meta{flex:1;min-width:0}.QmyFfG_name{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#101828);font-size:13px;font-weight:600;overflow:hidden}.QmyFfG_status{color:var(--dsw-alias-label-secondary,#667085);margin-top:2px;font-size:11px}.QmyFfG_actions{gap:4px;display:flex}.QmyFfG_action{color:var(--dsw-alias-label-secondary,#667085);cursor:pointer;background:0 0;border:0;border-radius:6px;padding:3px 5px;font-size:12px}.QmyFfG_action:hover{background:var(--dsw-alias-interactive-bg-hover,#f2f4f7);color:var(--dsw-alias-label-primary,#101828)}.QmyFfG_preview{white-space:pre-wrap;word-break:break-word;background:var(--dsw-alias-interactive-bg-hover,#f7f8fa);max-height:180px;color:var(--dsw-alias-label-secondary,#475467);border-radius:7px;margin-top:8px;padding:8px;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;overflow:auto}.QmyFfG_note{color:var(--dsw-alias-label-tertiary,#98a2b3);margin-top:6px;font-size:11px;line-height:16px}.QmyFfG_warning{color:#b54708;margin-top:6px;font-size:11px}.QmyFfG_progress{background:#eaecf0;border-radius:2px;height:3px;margin-top:7px;overflow:hidden}.QmyFfG_progressBar{background:var(--dsw-alias-state-business-primary,#4d6bfe);height:100%;transition:width .15s}.QmyFfG_notice{color:#067647;font-size:12px}.QmyFfG_error{color:#b42318;font-size:12px}.QmyFfG_overlay{z-index:10000;backdrop-filter:blur(2px);pointer-events:none;background:#2f42732e;place-items:center;display:grid;position:fixed;inset:0}.QmyFfG_overlayBox{border:2px dashed var(--dsw-alias-state-business-primary,#4d6bfe);color:#253b80;background:#fffffff0;border-radius:18px;padding:34px 48px;font-size:16px;font-weight:650;box-shadow:0 12px 40px #10182826}";
		const tagId = "dsh-dragndrop-attachments/AttachmentDock.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-dragndrop-attachments";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var AttachmentDock_module_css_default = {
			"action": "QmyFfG_action",
			"actions": "QmyFfG_actions",
			"card": "QmyFfG_card",
			"cardTop": "QmyFfG_cardTop",
			"dock": "QmyFfG_dock",
			"error": "QmyFfG_error",
			"hidden": "QmyFfG_hidden",
			"icon": "QmyFfG_icon",
			"meta": "QmyFfG_meta",
			"name": "QmyFfG_name",
			"note": "QmyFfG_note",
			"notice": "QmyFfG_notice",
			"overlay": "QmyFfG_overlay",
			"overlayBox": "QmyFfG_overlayBox",
			"preview": "QmyFfG_preview",
			"progress": "QmyFfG_progress",
			"progressBar": "QmyFfG_progressBar",
			"rail": "QmyFfG_rail",
			"status": "QmyFfG_status",
			"warning": "QmyFfG_warning"
		};
		//#endregion
		//#region src/client/AttachmentDock.tsx
		const ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.txt,.md,.markdown,.csv,.docx,.xlsx,.pptx,.zip,.json,.jsonl,.yaml,.yml,.toml,.xml,.tsv,.py,.js,.jsx,.ts,.tsx,.css,.html,.sh,.sql,.log";
		const SUPPORTED = /\.(png|jpe?g|webp|gif|txt|md|markdown|csv|docx|xlsx|pptx|zip|json|jsonl|ndjson|ya?ml|toml|xml|tsv|py|jsx?|tsx?|css|html?|sh|zsh|sql|log|ini|conf|env|properties|java|go|rs|c|h|cpp|hpp)$/iu;
		function formatBytes(bytes) {
			if (bytes < 1024) return `${bytes} B`;
			if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KiB`;
			return `${Math.round(bytes / 1024 / 1024 * 10) / 10} MiB`;
		}
		function supported(file) {
			return isImageFile(file) || SUPPORTED.test(file.name);
		}
		function isPickerAbort(value) {
			return value instanceof Error && value.name === "AbortError";
		}
		function fileBadge(record) {
			if (record.kind === "folder") return "DIR";
			const extension = /\.([^.]+)$/u.exec(record.name)?.[1]?.toLocaleUpperCase();
			return extension === void 0 ? "FILE" : extension.slice(0, 4);
		}
		function AttachmentDock({ useInput, inputActions, list, upload, removeDraft, commitReferences, registerPicker, attachNativeImages }) {
			const phase = useInput((state) => state.phase);
			const fileInputRef = (0, react.useRef)(null);
			const folderInputRef = (0, react.useRef)(null);
			const handleItemsRef = (0, react.useRef)(() => Promise.resolve());
			const committedKey = (0, react.useRef)("");
			const [records, setRecords] = (0, react.useState)([]);
			const [uploads, setUploads] = (0, react.useState)([]);
			const [expanded, setExpanded] = (0, react.useState)(null);
			const [dragActive, setDragActive] = (0, react.useState)(false);
			const [notice, setNotice] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const reportError = (0, react.useCallback)((value) => {
				setError(value instanceof Error ? value.message : String(value));
			}, []);
			const pending = (0, react.useMemo)(() => records.filter((record) => !record.committed), [records]);
			const pendingIds = (0, react.useMemo)(() => pending.map((record) => record.attachmentId), [pending]);
			const openInput = (0, react.useCallback)(async (input) => {
				if (input === null) return;
				await new Promise((resolve, reject) => {
					const cleanup = () => {
						input.removeEventListener("change", settle);
						input.removeEventListener("cancel", settle);
					};
					const settle = () => {
						cleanup();
						resolve();
					};
					const fail = (value) => {
						cleanup();
						reject(value);
					};
					input.addEventListener("change", settle, { once: true });
					input.addEventListener("cancel", settle, { once: true });
					if (typeof input.showPicker === "function") try {
						input.showPicker();
						return;
					} catch (showPickerError) {
						try {
							input.click();
							return;
						} catch {
							fail(showPickerError);
							return;
						}
					}
					try {
						input.click();
					} catch (value) {
						fail(value);
					}
				});
			}, []);
			const openFile = (0, react.useCallback)(async () => {
				try {
					await openInput(fileInputRef.current);
				} catch (value) {
					reportError(value);
				}
			}, [openInput, reportError]);
			const openFolder = (0, react.useCallback)(async () => {
				if (!supportsModernDirectoryPicker()) {
					try {
						await openInput(folderInputRef.current);
					} catch (value) {
						reportError(value);
					}
					return;
				}
				try {
					await handleItemsRef.current([await collectPickedDirectory()]);
				} catch (value) {
					if (!isPickerAbort(value)) reportError(value);
				}
			}, [openInput, reportError]);
			(0, react.useEffect)(() => {
				const input = folderInputRef.current;
				input?.setAttribute("webkitdirectory", "");
				input?.setAttribute("directory", "");
			}, []);
			(0, react.useEffect)(() => registerPicker({
				openFile,
				openFolder
			}), [
				openFile,
				openFolder,
				registerPicker
			]);
			const refresh = (0, react.useCallback)(async () => {
				setRecords(await list());
			}, [list]);
			(0, react.useEffect)(() => {
				refresh().catch((value) => {
					setError(value instanceof Error ? value.message : String(value));
				});
			}, [refresh]);
			(0, react.useEffect)(() => {
				if (phase !== "submitting" || pendingIds.length === 0) return;
				const key = [...pendingIds].sort().join("|");
				if (key === committedKey.current) return;
				committedKey.current = key;
				commitReferences(pendingIds).then(() => {
					const committed = new Set(pendingIds);
					setRecords((current) => current.map((record) => committed.has(record.attachmentId) ? {
						...record,
						committed: true
					} : record));
				}).catch((value) => {
					setError(value instanceof Error ? value.message : String(value));
				});
			}, [
				commitReferences,
				pendingIds,
				phase
			]);
			const updateUpload = (0, react.useCallback)((name, percent, uploadPhase) => {
				setUploads((current) => [...current.filter((item) => item.name !== name), {
					name,
					percent,
					phase: uploadPhase
				}]);
			}, []);
			const appendRecord = (0, react.useCallback)((record) => {
				setRecords((current) => current.some((entry) => entry.attachmentId === record.attachmentId) ? current : [...current, record]);
			}, []);
			const uploadOne = (0, react.useCallback)(async (source) => {
				const name = source.kind === "file" ? source.file.name : source.name;
				updateUpload(name, 0, "上传中");
				try {
					appendRecord(await upload(source, (percent, uploadPhase) => {
						updateUpload(name, percent, uploadPhase);
					}));
				} finally {
					setUploads((current) => current.filter((item) => item.name !== name));
				}
			}, [
				appendRecord,
				updateUpload,
				upload
			]);
			const handleItems = (0, react.useCallback)(async (items) => {
				setError(null);
				setNotice(null);
				const files = items.filter((item) => item.kind === "file").map((item) => item.file);
				const rejected = files.filter((file) => !supported(file));
				if (rejected.length > 0) setError(`不支持：${rejected.map((file) => file.name).join("、")}。支持图片、文本/Markdown、CSV、Office 和 ZIP。`);
				const accepted = files.filter(supported);
				const images = accepted.filter(isImageFile);
				if (images.length > 0) try {
					await attachNativeImages(images, inputActions.addImages);
				} catch (value) {
					setError(value instanceof Error ? value.message : String(value));
				}
				for (const file of accepted.filter((file) => !isImageFile(file))) await uploadOne({
					kind: "file",
					file
				});
				for (const folder of items.filter((item) => item.kind === "folder")) {
					const encoded = await encodeFolderSnapshot(folder);
					if (encoded.emptyDirectories === "unavailable") setNotice("当前文件夹选择器无法报告空目录；其余文件和路径已作为快照保存。");
					await uploadOne(encoded);
				}
			}, [
				attachNativeImages,
				inputActions.addImages,
				uploadOne
			]);
			handleItemsRef.current = handleItems;
			(0, react.useEffect)(() => bindFileIntake(document, window, handleItems, setDragActive, reportError), [handleItems, reportError]);
			const detach = (0, react.useCallback)((record) => {
				setExpanded((current) => current === record.attachmentId ? null : current);
				removeDraft(record.attachmentId).then(refresh).catch((value) => {
					setError(value instanceof Error ? value.message : String(value));
				});
			}, [refresh, removeDraft]);
			const visible = pending.length > 0 || uploads.length > 0 || notice !== null || error !== null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					ref: fileInputRef,
					className: AttachmentDock_module_css_default.hidden,
					type: "file",
					multiple: true,
					accept: ACCEPT,
					"data-dsh-dragndrop-attachments": "ready",
					onChange: (event) => {
						const files = [...event.currentTarget.files ?? []];
						event.currentTarget.value = "";
						handleItems(files.map((file) => ({
							kind: "file",
							file
						}))).catch(reportError);
					}
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
					ref: folderInputRef,
					className: AttachmentDock_module_css_default.hidden,
					type: "file",
					multiple: true,
					onChange: (event) => {
						const files = [...event.currentTarget.files ?? []];
						event.currentTarget.value = "";
						handleItems(collectWebkitDirectory(files)).catch(reportError);
					}
				}),
				dragActive && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: AttachmentDock_module_css_default.overlay,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: AttachmentDock_module_css_default.overlayBox,
						children: "拖到这里，自动处理图片、文件和文件夹"
					})
				}),
				visible && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: AttachmentDock_module_css_default.dock,
					"data-dsh-dragndrop-attachment-dock": "ready",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: AttachmentDock_module_css_default.rail,
							children: [uploads.map((item) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: AttachmentDock_module_css_default.card,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: AttachmentDock_module_css_default.cardTop,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: AttachmentDock_module_css_default.icon,
										children: "UP"
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: AttachmentDock_module_css_default.meta,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: AttachmentDock_module_css_default.name,
											children: item.name
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: AttachmentDock_module_css_default.status,
											children: [
												item.phase,
												" · ",
												item.percent,
												"%"
											]
										})]
									})]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: AttachmentDock_module_css_default.progress,
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: AttachmentDock_module_css_default.progressBar,
										style: { width: `${item.percent}%` }
									})
								})]
							}, `upload:${item.name}`)), pending.map((record) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: AttachmentDock_module_css_default.card,
								"data-attachment-id": record.attachmentId,
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: AttachmentDock_module_css_default.cardTop,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												className: AttachmentDock_module_css_default.icon,
												children: fileBadge(record)
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: AttachmentDock_module_css_default.meta,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
													className: AttachmentDock_module_css_default.name,
													title: record.name,
													children: record.name
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													className: AttachmentDock_module_css_default.status,
													children: [
														record.kind === "folder" ? `${record.fileCount} 文件 · ${record.directoryCount} 文件夹 · ` : "",
														record.status,
														" · ",
														formatBytes(record.bytes),
														" · 本地"
													]
												})]
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
												className: AttachmentDock_module_css_default.actions,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: AttachmentDock_module_css_default.action,
													onClick: () => setExpanded((current) => current === record.attachmentId ? null : record.attachmentId),
													children: "预览"
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: AttachmentDock_module_css_default.action,
													onClick: () => detach(record),
													children: "移除"
												})]
											})
										]
									}),
									record.warnings.map((warning) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: warning.code === "ARCHIVE_BINARY_ENTRIES" || warning.code === "FOLDER_BINARY_ENTRIES" ? AttachmentDock_module_css_default.note : AttachmentDock_module_css_default.warning,
										children: warning.message
									}, `${warning.code}:${warning.message}`)),
									expanded === record.attachmentId && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: AttachmentDock_module_css_default.preview,
										children: record.preview || "已建立结构索引，模型会按需读取。"
									})
								]
							}, record.attachmentId))]
						}),
						notice !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: AttachmentDock_module_css_default.notice,
							children: notice
						}),
						error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: AttachmentDock_module_css_default.error,
							children: error
						})
					]
				})
			] });
		}
		//#endregion
		//#region src/client/index.tsx
		const name = "dsh-dragndrop-attachments-client";
		const inject = [
			"connection",
			"slots",
			"conversation",
			"commandUi"
		];
		const ATTACHMENT_MENU_LABEL = "文件和文件夹";
		const ATTACHMENT_MENU_DETAIL = "添加图片、文档、ZIP 或整个文件夹";
		function rpcConnection(value) {
			if (!isRecord$1(value) || !isRecord$1(value.rpc) || typeof value.rpc.call !== "function") throw new Error("附件连接不可用。");
			return value;
		}
		function nativeConversation(value) {
			if (!isRecord$1(value) || typeof value.createDraftImages !== "function" || typeof value.releaseDraftImages !== "function") throw new Error("DSH 原生图片管线不可用。");
			return value;
		}
		function commandUi(value) {
			if (!isRecord$1(value) || typeof value.register !== "function") throw new Error("DSH 原生 + 菜单不可用。");
			return value;
		}
		/** Keep the attachment action at the top of DSH RC8's shared +/command list. */
		function bindAttachmentMenuPlacement() {
			let queued = false;
			const promote = () => {
				queued = false;
				for (const listbox of document.querySelectorAll("[role=\"listbox\"]")) {
					const options = [...listbox.querySelectorAll("[role=\"option\"]")];
					const attachment = options.find((option) => {
						const text = option.textContent ?? "";
						return text.includes(ATTACHMENT_MENU_LABEL) && text.includes(ATTACHMENT_MENU_DETAIL);
					});
					const first = options[0];
					if (attachment === void 0 || first === void 0 || attachment === first) continue;
					attachment.parentElement?.insertBefore(attachment, first);
				}
			};
			const schedule = () => {
				if (queued) return;
				queued = true;
				queueMicrotask(promote);
			};
			const observer = new MutationObserver(schedule);
			observer.observe(document.body, {
				childList: true,
				subtree: true
			});
			promote();
			return () => {
				observer.disconnect();
			};
		}
		function parseRecord(value) {
			if (!isRecord$1(value) || value.schemaVersion !== "dsh-codex-attachment.v1" || typeof value.attachmentId !== "string" || typeof value.name !== "string" || typeof value.mediaType !== "string" || typeof value.bytes !== "number" || value.kind !== "text" && value.kind !== "document" && value.kind !== "archive" && value.kind !== "folder" || typeof value.preview !== "string") throw new Error("附件服务返回了无效记录。");
			return value;
		}
		function bytesToBase64(data) {
			let binary = "";
			for (let offset = 0; offset < data.length; offset += 32768) binary += String.fromCharCode(...data.subarray(offset, offset + 32768));
			return btoa(binary);
		}
		function apply(ctx) {
			const pickers = /* @__PURE__ */ new Map();
			ctx.effect(bindAttachmentMenuPlacement, "dsh-dragndrop-attachments: pin native + menu entry");
			ctx.inject(["commandUi"], (scope) => {
				const commands = commandUi(scope.get("commandUi"));
				scope.effect(() => commands.register({
					name: "文件和文件夹",
					description: ATTACHMENT_MENU_DETAIL,
					available: (session) => pickers.has(session.sessionId),
					ui: {
						kind: "popupSelect",
						options: async () => [{
							id: "file",
							label: "选择文件"
						}, {
							id: "folder",
							label: "选择文件夹"
						}],
						onSelect: (option, session) => {
							const picker = pickers.get(session.sessionId);
							if (picker === void 0) return;
							return option.id === "file" ? picker.openFile() : picker.openFolder();
						}
					}
				}), "dsh-dragndrop-attachments: native + menu entry");
			});
			ctx.slots.inject("conversation.input.dock", () => ctx.slots.register({
				name: "conversation.input.dock",
				id: "dsh-dragndrop-attachments",
				order: -20,
				priority: 80,
				inject: (sessionId) => {
					const call = async (endpoint, payload) => {
						const result = await rpcConnection(ctx.get("connection")).rpc.call(ATTACHMENT_RPC_CHANNEL, endpoint, {
							sessionId,
							...payload
						});
						if (!result.ok) {
							const action = result.error.action === void 0 ? "" : ` ${result.error.action}`;
							throw new Error(`${result.error.message}${action}`);
						}
						return result.value;
					};
					return {
						list: async () => {
							const value = await call(ENDPOINTS.list, {});
							if (!isRecord$1(value) || !Array.isArray(value.attachments)) throw new Error("附件清单响应无效。");
							return value.attachments.map(parseRecord);
						},
						upload: async (source, progress) => {
							const file = source.kind === "file" ? source.file : void 0;
							const bytes = source.kind === "file" ? void 0 : source.snapshot;
							const name = source.kind === "file" ? source.file.name : source.name;
							const total = source.kind === "file" ? source.file.size : source.snapshot.byteLength;
							const begun = await call(source.kind === "file" ? ENDPOINTS.uploadBegin : ENDPOINTS.folderUploadBegin, source.kind === "file" ? {
								name,
								bytes: total
							} : {
								name,
								snapshotBytes: total,
								sourceBytes: source.sourceBytes,
								fileCount: source.fileCount,
								directoryCount: source.directoryCount
							});
							if (!isRecord$1(begun) || typeof begun.uploadId !== "string" || typeof begun.chunkBytes !== "number") throw new Error("附件上传初始化失败。");
							const uploadId = begun.uploadId;
							try {
								let index = 0;
								for (let offset = 0; offset < total; offset += begun.chunkBytes) {
									const chunk = file === void 0 ? bytes.slice(offset, Math.min(total, offset + begun.chunkBytes)) : new Uint8Array(await file.slice(offset, Math.min(total, offset + begun.chunkBytes)).arrayBuffer());
									await call(ENDPOINTS.uploadChunk, {
										uploadId,
										index,
										data: bytesToBase64(chunk)
									});
									index += 1;
									progress(Math.min(99, Math.round(Math.min(total, offset + chunk.byteLength) / total * 100)), "上传中");
								}
								progress(100, source.kind === "folder" ? "建立文件夹索引中" : /\.(docx|xlsx|pptx|csv)$/iu.test(name) ? "本地解析中" : "建立索引中");
								return parseRecord(await call(ENDPOINTS.uploadCommit, { uploadId }));
							} catch (error) {
								await call(ENDPOINTS.uploadCancel, { uploadId }).catch(() => {});
								throw error;
							}
						},
						removeDraft: async (attachmentId) => {
							const value = await call(ENDPOINTS.remove, { attachmentId });
							return isRecord$1(value) && value.removed === true;
						},
						commitReferences: async (attachmentIds) => {
							await call(ENDPOINTS.commitReferences, { attachmentIds });
						},
						registerPicker: (open) => {
							pickers.set(sessionId, open);
							return () => {
								if (pickers.get(sessionId) === open) pickers.delete(sessionId);
							};
						},
						attachNativeImages: async (files, accept) => {
							const prepared = [];
							for (const file of files) prepared.push(await prepareImage(file));
							const conversation = nativeConversation(ctx.get("conversation"));
							const attachments = conversation.createDraftImages(prepared.map((item) => item.file));
							if (!accept(attachments.map((item) => item.id))) {
								conversation.releaseDraftImages(attachments);
								throw new Error("当前输入框暂时不能接收图片。");
							}
							return prepared.map((item) => ({
								name: item.file.name,
								resized: item.resized,
								source: `${item.source.width}×${item.source.height}`,
								output: `${item.output.width}×${item.output.height}`
							}));
						}
					};
				}
			}, AttachmentDock));
		}
		//#endregion
		exports.AttachmentDock = AttachmentDock;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map