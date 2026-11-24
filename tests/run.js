// Tests for jp-overseas-deposit-tax.
// Run from the repository root:  node tests/run.js
// The tax engine is extracted from the production index.html (the block
// between "TAX ENGINE START" and "TAX ENGINE END") and run unchanged.
// Expected values come from the specification (Vault note
// "Web 海外預金 税務シミュレーター の仕様書", section 3) and from an
// independent reference implementation written from the NTA tables below.
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

let passed = 0, failed = 0;
function check(name, cond, detail){
  if(cond){ passed++; }
  else { failed++; console.log("FAIL: " + name + (detail ? "  (" + detail + ")" : "")); }
}
function eq(name, got, want){ check(name, got === want, "got " + got + ", want " + want); }

/* ---------- extract the engine ---------- */
const m = html.match(/\/\* ===== TAX ENGINE START =====[\s\S]*?\/\* ===== TAX ENGINE END ===== \*\//);
if(!m){ console.log("FAIL: TAX ENGINE block not found in index.html"); process.exit(1); }
const E = vm.runInNewContext(m[0] +
  "\n;({RULES, incomeTax, salaryDeduction, employmentIncome, basicDeduction, stage3Calc})", {});

/* ---------- independent reference (from NTA No.1199 / No.1410 / No.2260) ---------- */
const REF = {
  basic: {
    "2025": [[1320000,950000],[3360000,880000],[4890000,680000],[6550000,630000],[23500000,580000],
             [24000000,480000],[24500000,320000],[25000000,160000]],
    "2026": [[1320000,1040000],[3360000,1040000],[4890000,1040000],[6550000,670000],[23500000,620000],
             [24000000,480000],[24500000,320000],[25000000,160000]]
  }
};
function refBasic(ti, y){ for(const [l,a] of REF.basic[y]) if(ti<=l) return a; return 0; }
function refEmployment(S, y){
  if(y === "2026"){
    if(S < 741000) return 0;
    if(S < 2191000) return S - 740000;
    if(S < 2193000) return 1451000;
    if(S < 2196000) return 1453000;
    if(S < 2200000) return 1456000;
  }
  let k;
  const minLim = (y === "2026") ? 2200000 : 1900000, minAmt = (y === "2026") ? 740000 : 650000;
  if(S <= minLim) k = minAmt;
  else if(S <= 3600000) k = S*0.3 + 80000;
  else if(S <= 6600000) k = S*0.2 + 440000;
  else if(S <= 8500000) k = S*0.1 + 1100000;
  else k = 1950000;
  return Math.max(0, S - k);
}
function refIncomeTax(x){
  if(x <= 0) return 0;
  if(x <= 1949000) return x*0.05;
  if(x <= 3299000) return x*0.10 - 97500;
  if(x <= 6949000) return x*0.20 - 427500;
  if(x <= 8999000) return x*0.23 - 636000;
  if(x <= 17999000) return x*0.33 - 1536000;
  if(x <= 39999000) return x*0.40 - 2796000;
  return x*0.45 - 4796000;
}

/* ---------- 1. specification examples A–E (section 3) ---------- */
const SPEC = [
  // name, salary, interest, localTax, year, basicA, basicB, ktA, ktB, before, credit, after
  ["A","6000000",300000,42000,"2025",680000,680000,2780000,3080000,60630,17902,42728],
  ["A","6000000",300000,42000,"2026",1040000,1040000,2420000,2720000,60630,14840,45790],
  ["B","1500000",300000,42000,"2025",950000,950000,0,0,30000,0,30000],
  ["B","1500000",300000,42000,"2026",1040000,1040000,0,0,30000,0,30000],
  ["C","6425000",300000,30000,"2025",680000,630000,3056000,3406000,76558,20108,56450],
  ["C","6425000",300000,30000,"2026",1040000,670000,2696000,3366000,105146,19474,85672],
  ["D","2200000",300000,42000,"2025",880000,880000,250000,550000,45315,6192,39123],
  ["D","2200000",300000,42000,"2026",1040000,1040000,90000,390000,45315,4391,40924],
  ["E","25000000",1000000,100000,"2025",580000,320000,18720000,19980000,614584,100000,514584],
  ["E","25000000",1000000,100000,"2026",620000,320000,18680000,19980000,630920,100000,530920],
];
for(const [n,S,I,L,y,bA,bB,kA,kB,before,credit,after] of SPEC){
  const r = E.stage3Calc({year:y, interestYen:I, localTaxYen:L, fxIncomeYen:0,
                          salary:+S, otherIncome:0, dedMode:"auto", manualDed:0});
  const tag = "spec " + n + " " + y + " ";
  eq(tag+"basicA", r.basicA, bA); eq(tag+"basicB", r.basicB, bB);
  eq(tag+"ktA", r.ktA, kA);       eq(tag+"ktB", r.ktB, kB);
  eq(tag+"before", Math.round(r.s2), before);
  eq(tag+"credit", Math.round(r.credit), credit);
  eq(tag+"after", Math.round(r.s4), after);
}

/* ---------- 2. employment income at every boundary ---------- */
const salaryPoints = [0, 550000, 650000, 690999, 691000, 740999, 741000, 1000000, 1625000, 1625001,
  1800000, 1899999, 1900000, 1900001, 2190999, 2191000, 2192999, 2193000, 2195999, 2196000,
  2199999, 2200000, 2200001, 3600000, 3600001, 6600000, 6600001, 8500000, 8500001, 20000000];
for(const y of ["2025","2026"]){
  for(const S of salaryPoints){
    const got = E.employmentIncome(S, y), want = refEmployment(S, y);
    check("employment " + y + " S=" + S, Math.abs(got - want) < 1e-6, "got " + got + ", want " + want);
  }
}

/* ---------- 3. basic deduction at every boundary ("以下": the limit itself is in the lower band) ---------- */
const basicLimits = [1320000, 3360000, 4890000, 6550000, 23500000, 24000000, 24500000, 25000000];
for(const y of ["2025","2026"]){
  for(const lim of basicLimits){
    for(const ti of [lim-1, lim, lim+1]){
      eq("basic " + y + " ti=" + ti, E.basicDeduction(ti, y), refBasic(ti, y));
    }
  }
  eq("basic " + y + " ti=0", E.basicDeduction(0, y), refBasic(0, y));
}

/* ---------- 4. income-tax quick table at every edge ---------- */
for(const x of [0, 1000, 1949000, 1950000, 3299000, 3300000, 6949000, 6950000, 8999000, 9000000,
                17999000, 18000000, 39999000, 40000000, 100000000]){
  check("incomeTax " + x, Math.abs(E.incomeTax(x) - refIncomeTax(x)) < 1e-6,
        "got " + E.incomeTax(x) + ", want " + refIncomeTax(x));
}
eq("NTA No.2260 example (7,000,000)", E.incomeTax(7000000), 974000);

/* ---------- 5. other branches ---------- */
// manual mode: the app adds the basic deduction itself
{
  const auto = E.stage3Calc({year:"2026", interestYen:300000, localTaxYen:42000, salary:6000000,
                             otherIncome:0, dedMode:"auto", manualDed:0});
  const man  = E.stage3Calc({year:"2026", interestYen:300000, localTaxYen:42000, salary:6000000,
                             otherIncome:0, dedMode:"manual", manualDed:900000});
  eq("manual 900,000 equals auto (15% of 6,000,000) ktA", man.ktA, auto.ktA);
  eq("manual 900,000 equals auto ktB", man.ktB, auto.ktB);
  eq("manual adds basic deduction", man.basicA, 1040000);
}
// FX gain raises total income (and can move the basic-deduction band) but not the credit base
{
  const r = E.stage3Calc({year:"2026", interestYen:300000, localTaxYen:30000, fxIncomeYen:200000,
                          salary:6425000, otherIncome:0, dedMode:"auto", manualDed:0});
  eq("fx gain moves total income without interest above 4.89M", r.basicA, 670000);
}
// zero interest
{
  const r = E.stage3Calc({year:"2026", interestYen:0, localTaxYen:0, salary:6000000,
                          otherIncome:0, dedMode:"auto", manualDed:0});
  eq("zero interest: erate 0", r.erate, 0); eq("zero interest: tax 0", r.s2, 0);
}
// 2027 is not offered
check("RULES has only 2025 and 2026", JSON.stringify(Object.keys(E.RULES.years)) === '["2025","2026"]');
eq("default year is 2026", E.RULES.defaultYear, "2026");

/* ---------- 6. page: radio buttons, URL key, dictionaries ---------- */
check("radio ty2025 exists", /<input type="radio" name="taxYear" id="ty2025" value="2025">/.test(html));
check("radio ty2026 exists and is checked", /<input type="radio" name="taxYear" id="ty2026" value="2026" checked>/.test(html));
check("no 2027 radio", !/id="ty2027"/.test(html));
check("URL field ty exists", /\["ty",/.test(html));
check("old fixed basic deduction removed", !/salary\*0\.15 \+ 480000/.test(html));
check("s3_assume no longer says 48万円", !/基礎控除48万円/.test(html));
check("s3_assume (en) no longer says 480,000", !/¥480,000 basic deduction/.test(html));
check("withholding-rate update date unchanged (July 2026)", /src_date:"2026年7月"/.test(html) && /src_date:"July 2026"/.test(html));

const im = html.match(/const I18N = (\{[\s\S]*?\n\});/);
if(!im){ check("I18N block found", false); }
else{
  const I18N = vm.runInNewContext("(" + im[1] + ")", {});
  const ja = Object.keys(I18N.ja), en = Object.keys(I18N.en);
  eq("I18N key count ja = en", ja.length, en.length);
  const missingEn = ja.filter(k => !(k in I18N.en)), missingJa = en.filter(k => !(k in I18N.ja));
  check("every ja key is in en", missingEn.length === 0, missingEn.join(","));
  check("every en key is in ja", missingJa.length === 0, missingJa.join(","));
  // "＊" (U+FF0A) is allowed: it is the required-field mark shown on the page in both languages.
  const jpRe = /[぀-ヿ㐀-鿿！-）＋-｠]/;
  const jpInEn = en.filter(k => typeof I18N.en[k] === "string" && jpRe.test(I18N.en[k]));
  check("no Japanese left in the English dictionary", jpInEn.length === 0, jpInEn.join(","));
  const used = [...html.matchAll(/data-i18n(?:-html)?="([^"]+)"/g)].map(x => x[1]);
  const notInJa = [...new Set(used)].filter(k => !(k in I18N.ja));
  check("every data-i18n key on the page exists", notInJa.length === 0, notInJa.join(","));
  for(const k of ["f_taxYear","ty2025","ty2026","h_taxYear","src_t5","src_l5","src_d5"]){
    check("key " + k + " in ja and en", (k in I18N.ja) && (k in I18N.en));
  }
}

/* ---------- 7. notice for links shared before the tax-year selector ---------- */
const lm = html.match(/\/\* ===== LINK COMPAT START =====[\s\S]*?\/\* ===== LINK COMPAT END ===== \*\//);
if(!lm){ check("LINK COMPAT block found", false); }
else{
  const isLegacy = vm.runInNewContext(lm[0] + "\n;isLegacyManualLink", {});
  const L = q => isLegacy(new URLSearchParams(q));
  eq("old link, manual, md>0 -> notice",       L("sa=6000000&dm=m&md=1380000"), true);
  eq("old link, manual, md=0 -> no notice",    L("sa=6000000&dm=m&md=0"), false);
  eq("old link, manual, md empty -> no notice", L("dm=m&md="), false);
  eq("old link, automatic -> no notice",       L("sa=6000000&dm=a&md=1380000"), false);
  eq("new link (ty), manual, md>0 -> no notice", L("ty=2026&dm=m&md=900000"), false);
  eq("new link (ty=2025), manual -> no notice",  L("ty=2025&dm=m&md=900000"), false);
  eq("no parameters -> no notice",             L(""), false);
}
check("notice element exists, hidden by default",
      /<p class="cwarn hidden" id="legacyDedNote" data-i18n="legacyDedNote">/.test(html));
check("notice shown only in manual mode while the flag is on",
      /\$\("legacyDedNote"\)\.classList\.toggle\("hidden", !\(legacyDedNote && mode==="manual"\)\)/.test(html));
check("editing the manual amount clears the notice",
      /\$\("manualDed"\)\.addEventListener\("input", \(\) => \{ legacyDedNote = false; \}\)/.test(html));
check("the flag is set before the first compute()",
      html.indexOf("let legacyDedNote") < html.indexOf("applyLang(initialLang());"));

/* ---------- 8. reviewed wording (CRO points 1, 2, 3, 6, 7) ---------- */
if(im){
  const I18N = vm.runInNewContext("(" + im[1] + ")", {});
  check("ja h_fx says one rate is used", /このアプリは1つのレートで概算します/.test(I18N.ja.h_fx));
  check("ja fxRole says the rate is also the deposit rate for FX gain", /為替差益では、預入時のレートとしても使います/.test(I18N.ja.fxRole));
  check("en h_fx says one rate is used", /single rate/.test(I18N.en.h_fx));
  check("ja src_d5 names what it covers", /基礎控除・給与所得控除・所得税の税率は、令和7年分・令和8年分について/.test(I18N.ja.src_d5));
  check("en src_d5 names what it covers", /for 2025 and 2026 reflect/.test(I18N.en.src_d5));
  check("ja compound note mentions the selected year", /選んだ年分の控除で計算する概算です/.test(I18N.ja.s3_basisCompound(3)));
  check("en compound note mentions the selected year", /deductions of the selected tax year/.test(I18N.en.s3_basisCompound(3)));
  check("en h_taxYear wording", /^The 2026 tax year is the one you file a return for in 2027\./.test(I18N.en.h_taxYear));
  eq("legacy notice (ja)", I18N.ja.legacyDedNote, "入力の意味が変わりました（基礎控除はアプリが足します）。所得控除を入れ直してください。");
  // static HTML text must match the ja dictionary for the keys touched in this change
  for(const k of ["s3_assume","h_fx","src_d5","f_manualDed","h_manualDed","legacyDedNote","f_taxYear","h_taxYear"]){
    const re = new RegExp('data-i18n(?:-html)?="' + k + '">([\\s\\S]*?)</(?:p|div|span|label)>');
    const mm = html.match(re);
    check("static HTML matches dictionary: " + k, !!mm && mm[1] === I18N.ja[k],
          mm ? "html: " + mm[1].slice(0, 60) : "not found");
  }
}

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
