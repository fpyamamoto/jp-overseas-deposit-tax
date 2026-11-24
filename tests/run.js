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
  "\n;({RULES, incomeTax, salaryDeduction, employmentIncome, basicDeduction, stage3Calc, filingState})", {});

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
// update dates: five countries re-checked in November 2026, the others as of July 2026 (CRO point 1)
check("update date names both months (ja)", /src_date:"2026年11月（タイ・トルコ・ジョージア・フィリピン・メキシコ。ほかの国は2026年7月）"/.test(html));
check("update date names both months (en)", /src_date:"November 2026 \(Thailand, Türkiye, Georgia, the Philippines and Mexico; other countries July 2026\)"/.test(html));
check("credit agrees with the update date (ja)", (html.match(/（タイなど5か国は2026年11月、ほかの国は2026年7月の時点）/g) || []).length === 2 && !/（2026年7月時点）/.test(html) && !/一部の国は2026年7月/.test(html));
check("credit agrees with the update date (en)", /\(five countries, including Thailand, as of November 2026; other countries as of July 2026\)\./.test(html) && !/some countries July 2026/.test(html));
check("no 'as of the update date above' left in ja", !/上の更新日のままです/.test(html));
check("static update date matches the dictionary", /<strong data-i18n="src_date">2026年11月（タイ・トルコ・ジョージア・フィリピン・メキシコ。ほかの国は2026年7月）<\/strong>/.test(html));

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
  const omit = vm.runInNewContext(lm[0] + "\n;omitFromShare", {});
  eq("share omits ty while the notice is on", omit("ty", true), true);
  eq("share keeps ty once the notice is off", omit("ty", false), false);
  eq("share keeps md while the notice is on", omit("md", true), false);
  eq("share keeps dm while the notice is on", omit("dm", true), false);
}
check("buildShareUrl skips keys by omitFromShare",
      /URL_FIELDS\.forEach\(\(\[k, get\]\) => \{\s*if\(omitFromShare\(k, legacyDedNote\)\) return;/.test(html));
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
  check("ja h_fx says all interest uses this rate", /このアプリは、利息をすべてこのレートで円にして概算します/.test(I18N.ja.h_fx));
  check("ja fxRole says the rate is also the deposit rate for FX gain", /為替差益では、預入時のレートとしても使います/.test(I18N.ja.fxRole));
  check("en h_fx says all interest uses this rate", /converts all interest at this one rate/.test(I18N.en.h_fx));
  check("ja src_d5 names what it covers", /基礎控除・給与所得控除・所得税の税率は、令和7年分・令和8年分について/.test(I18N.ja.src_d5));
  check("en src_d5 names what it covers (up to and including)", /for 2025 and 2026 reflect tax reforms up to and including the FY2026 reform/.test(I18N.en.src_d5));
  check("ja compound note mentions the selected year", /選んだ年分の控除で計算する概算です/.test(I18N.ja.s3_basisCompound(3)));
  check("en compound note mentions the selected year", /deductions of the selected tax year/.test(I18N.en.s3_basisCompound(3)));
  check("en h_taxYear wording", /^The 2026 tax year is the one you file a return for in 2027\./.test(I18N.en.h_taxYear));
  eq("legacy notice (ja)", I18N.ja.legacyDedNote, "『所得控除（手入力）』の入力の意味が変わりました。基礎控除はアプリが足すので、基礎控除を除いた額を入れ直してください。");
  check("legacy notice (en) names the field", /‘Deductions \(manual\)’/.test(I18N.en.legacyDedNote) && /without it/.test(I18N.en.legacyDedNote));
  // static HTML text must match the ja dictionary for the keys touched in this change
  for(const k of ["s3_assume","h_fx","src_d5","f_manualDed","h_manualDed","legacyDedNote","f_taxYear","h_taxYear","h_other"]){
    const re = new RegExp('data-i18n(?:-html)?="' + k + '">([\\s\\S]*?)</(?:p|div|span|label)>');
    const mm = html.match(re);
    check("static HTML matches dictionary: " + k, !!mm && mm[1] === I18N.ja[k],
          mm ? "html: " + mm[1].slice(0, 60) : "not found");
  }
}

/* ---------- 9. filing state: no duty to file when income tax is ¥0 (Income Tax Act Art.120(1)) ---------- */
{
  const fs_ = (under, other, tax, entered) => E.filingState({salaryUnder20M:under, otherIncomeTotal:other,
                                                   filingLine:200000, incomeTaxTotal:tax,
                                                   salaryEntered: entered === undefined ? true : entered});
  eq("<= ¥200,000 and salary <= ¥20M -> noFile", fs_(true, 200000, null), "noFile");
  eq("<= ¥200,000 even if tax is 0 -> noFile",    fs_(true, 200000, 0), "noFile");
  eq("> ¥200,000, tax unknown -> file",           fs_(true, 200001, null), "file");
  eq("> ¥200,000, tax 0 -> zeroTax",              fs_(true, 200001, 0), "zeroTax");
  eq("> ¥200,000, tax 50 -> file",                fs_(true, 200001, 50), "file");
  eq("salary > ¥20M ('no'), tax 0 -> file (no zeroTax)", fs_(false, 0, 0), "file");
  eq("salary > ¥20M, tax > 0 -> file",            fs_(false, 0, 1000000), "file");
  eq("salary field empty, tax 0 -> file (no zeroTax)", fs_(true, 300000, 0, false), "file");
  // CRO round 4, point 1: step-1 side income must reach the tax calculation
  {
    const withSide = E.stage3Calc({year:"2026", interestYen:100000, localTaxYen:14000, salary:1500000,
                                   otherIncome:Math.max(0, 500000), dedMode:"auto", manualDed:0});
    eq("salary 1.5M + interest 100k + side 500k (2026): income tax 4,750", withSide.txB, 4750);
    eq("... so the verdict is file", fs_(true, 600000, withSide.txB), "file");
    check("stage 3 uses the larger of side and other income",
          /otherIncome: Math\.max\(otherIn, sideIncome\)/.test(html));
    check("compute passes step-1 side income to stage 3",
          /computeStage3\(taxYearInterestYen, taxYearLocalTaxYen, isCompound, years, fxIncomeYen, side\)/.test(html));
    check("zeroTax needs an entered salary", /salaryEntered: !isNaN\(num\(\$\("salary"\)\)\)/.test(html));
  }
  // smallest positive tax: taxable income ¥1,000 -> ¥50
  eq("incomeTax(1000) is 50", E.incomeTax(1000), 50);
  // spec examples: B is ¥0 in both years, A/C/D/E are not
  const st = (S, I, L, y) => {
    const r = E.stage3Calc({year:y, interestYen:I, localTaxYen:L, salary:S, otherIncome:0, dedMode:"auto", manualDed:0});
    return fs_(S <= 20000000, I, r.txB);
  };
  for(const y of ["2025","2026"]){
    eq("spec B " + y + " -> zeroTax", st(1500000, 300000, 42000, y), "zeroTax");
    eq("spec A " + y + " -> file",    st(6000000, 300000, 42000, y), "file");
    eq("spec C " + y + " -> file",    st(6425000, 300000, 30000, y), "file");
    eq("spec D " + y + " -> file",    st(2200000, 300000, 42000, y), "file");
    eq("spec E " + y + " -> file",    st(25000000, 1000000, 100000, y), "file");
  }
  // txB is the income tax on all income including the interest
  const rB = E.stage3Calc({year:"2026", interestYen:300000, localTaxYen:42000, salary:1500000,
                           otherIncome:0, dedMode:"auto", manualDed:0});
  eq("spec B 2026 txB", rB.txB, 0);
  check("verdict switches to zeroTax after step 3", /=== "zeroTax"\)\{\s*v\.classList\.remove\("file"\); v\.classList\.add\("go"\);/.test(html));
  check("computeStage3 returns its numbers", /\n  return r;\n\}/.test(html.replace(/\r\n/g, "\n")));
  if(im){
    const I18N = vm.runInNewContext("(" + im[1] + ")", {});
    for(const k of ["stampZero","vZeroTitle","vZeroReason"]){
      check("key " + k + " in ja and en", (k in I18N.ja) && (k in I18N.en));
    }
    check("ja reason cites Art.120(1)", /所得税法120条1項/.test(I18N.ja.vZeroReason));
    check("ja reason: tax computed including interest is ¥0 (no 'deductions or less')",
          /利息を含めて計算した所得税は0円の見込みです/.test(I18N.ja.vZeroReason) && !/所得控除以下/.test(I18N.ja.vZeroReason));
    check("ja reason: deductions are estimates for the selected year",
          /所得控除は見積り（自動では社会保険料を給与の15%）で、選んだ年分で計算しています/.test(I18N.ja.vZeroReason));
    check("ja reason: resident tax return is required (Local Tax Act 317-2(1))",
          /住民税の申告（3月15日まで）が必要です（地方税法317条の2第1項/.test(I18N.ja.vZeroReason));
    check("en reason cites Art. 120(1)", /Art\. 120\(1\)/.test(I18N.en.vZeroReason));
    check("en reason names the salary condition", /salary ¥20m or less, other income ¥200,000 or less/.test(I18N.en.vZeroReason));
    check("en reason: resident tax (Art. 317-2(1))", /Art\. 317-2\(1\)/.test(I18N.en.vZeroReason));
    // CRO round 4, point 2: no "a return is required" in the compound note when tax is ¥0
    check("ja compound note for zeroTax drops '毎年の申告が必要'", !/毎年の申告が必要/.test(I18N.ja.s3_basisCompoundZero(3)));
    check("en compound note for zeroTax drops 'a return is required in each'", !/a return is required in each/.test(I18N.en.s3_basisCompoundZero(3)));
    check("compound note switched in the zeroTax branch", /if\(isCompound\) \$\("s3_basisNote"\)\.textContent=t\("s3_basisCompoundZero"\)\(years\);/.test(html));
    // CRO round 4, point 9 + Income Tax Act 95(11): keep the carry-forward note, reworded
    check("ja carry note for zeroTax", /所得税の申告の義務はありませんが、外国税額控除の繰越を使う場合は申告が必要です/.test(I18N.ja.carryNoteZero) && /所得税法95条11項/.test(I18N.ja.carryNoteZero));
    check("en carry note for zeroTax", /must file one if you want to carry the foreign tax credit forward/.test(I18N.en.carryNoteZero) && /Art\. 95\(11\)/.test(I18N.en.carryNoteZero));
    check("carry notes keep the r_carry slot", /id="r_carry"/.test(I18N.ja.carryNoteZero) && /id="r_carry"/.test(I18N.en.carryNoteZero));
    check("carry note restored at the start of stage 3", /\$\("carryNote"\)\.innerHTML = t\("carryNote"\);/.test(html));
    check("ja h_other explains the larger amount", /第1段階の「副業などの別収入」と大きいほうの額で計算します/.test(I18N.ja.h_other));
  }
}

/* ---------- 10. narrow screens: long row labels must not widen the page ---------- */
check("one-column grid uses minmax(0,1fr)", /@media\(max-width:760px\)\{\.grid\{grid-template-columns:minmax\(0,1fr\);\}\}/.test(html));
check("row labels wrap on narrow screens", /@media\(max-width:520px\)\{\.lrow \.k\{white-space:normal;min-width:0;\}\}/.test(html));

/* ---------- 11. withholding table (re-checked 2026-11-24; same as the yield calculator) ---------- */
{
  const cm = html.match(/const COUNTRIES = (\[[\s\S]*?\n\]);/);
  check("COUNTRIES found", !!cm);
  if(cm){
    const COUNTRIES = vm.runInNewContext("(" + cm[1] + ")", {});
    const C = name => COUNTRIES.find(c => c.name === name);
    eq("28 rows", COUNTRIES.length, 28);
    const T = {
      "タイ":       {rate:0.15, treaty:"有", range:false},   // Japan-Thailand treaty 11(2): caps for companies only; Revenue Code s.50(2)(a) 15%
      "トルコ":     {rate:0.15, treaty:"有", range:true},    // Japan-Turkey treaty 11(2)(b) 15%
      "ジョージア": {rate:0.05, treaty:"有", range:false},   // Japan-Georgia treaty 11(2) 5%
      "フィリピン": {rate:0.10, treaty:"有", range:false},   // treaty 11(2) as amended 10%
      "メキシコ":   {rate:0.10, treaty:"有", range:false},   // treaty 11(2)(a)(iii) 10% for interest paid by a bank
    };
    for(const [name, w] of Object.entries(T)){
      const c = C(name);
      check(name + " row exists", !!c);
      if(!c) continue;
      eq(name + " rate", c.rate, w.rate); eq(name + " treaty", c.treaty, w.treaty); eq(name + " range mark", !!c.range, w.range);
    }
    check("タイ note", /受け取る人が法人のときだけ。個人はタイ国内法の15%/.test(C("タイ").note));
    check("ジョージア note and source", /2021年7月発効/.test(C("ジョージア").note) && /tax_convetion_list_jp\.html$/.test(C("ジョージア").src));
    check("フィリピン note has no 15%", !/15%/.test(C("フィリピン").note));
    // the stage-3 figures move with the Thai rate (THB 1,000,000 at 1.5% = 15,000 interest -> 2,250 withheld)
    eq("Thai withholding on 15,000 interest", Math.round(15000 * C("タイ").rate), 2250);
  }
  if(im){
    const I18N = vm.runInNewContext("(" + im[1] + ")", {});
    check("src_w1 (ja): no old Thai/Philippine examples", !/タイは条約上10〜25%/.test(I18N.ja.src_w1) && !/フィリピンは一部15%/.test(I18N.ja.src_w1));
    check("src_w1 (ja): re-checked countries", /タイ・トルコは条約と国内法で、ジョージア・フィリピン・メキシコは条約で、2026年11月に確かめ直しました。ほかの国は2026年7月の時点の値です。/.test(I18N.ja.src_w1));
    check("src_w1 (en): no old examples", !/Thailand ranges 10–25%/.test(I18N.en.src_w1) && !/15% in some cases/.test(I18N.en.src_w1));
    check("src_lede (ja): domestic rate rule", /タイのように条約の上限が個人に当たらない国や、国内法の率のほうが低い国（香港・マレーシアなど）は、国内法の率を入れています。国内法の率を確かめていない国もあります。/.test(I18N.ja.src_lede));
    check("src_lede (en): domestic rate rule", /Where the treaty cap does not apply to individuals \(Thailand\)/.test(I18N.en.src_lede));
    check("static src_w1 matches dictionary", (html.match(/data-i18n-html="src_w1">([\s\S]*?)<\/li>/) || [])[1] === I18N.ja.src_w1);
    check("static src_lede has the domestic rate rule", /国内法に優先します。タイのように条約の上限が個人に当たらない国/.test(html));
  }
}

console.log(passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
