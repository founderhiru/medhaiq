// db/campus-content-seed.js — Campus Ready V1 starter content.
//
// Idempotent: ensureCampusContentSeeded() only inserts if campus_topics is
// empty, so it's safe to call on every server boot (same pattern as
// db/migrate.js's fixed_costs seed). This is CONTENT, not schema — adding
// a 16th topic or a 400th question later is a data change to this file,
// never a migration.

const { pool } = require('./index');

const SEED = [
  {
    moduleKey: 'tell_your_story',
    topics: [
      {
        key: 'self_introduction', name: 'Self-Introduction',
        items: [
          { type: 'learn_example',
            prompt: 'How should you structure a self-introduction in a placement interview?',
            guidance: 'Strong: follows a Present → Past → Future arc in under 90 seconds — current status/course, 1-2 relevant experiences or projects, then what you\'re looking for next. Weak: recites the resume line by line, starts with family/hometown, and has no forward-looking close.',
            mistakes: 'Reciting the resume verbatim; opening with biography instead of professional identity; no mention of what you want next; running past 2 minutes; flat delivery with no energy.' },
          { type: 'practice_prompt', prompt: 'Write and read aloud a 90-second self-introduction using Present → Past → Future.' },
          { type: 'practice_prompt', prompt: 'Rewrite your introduction to fit a 30-second rapid-fire round.' },
          { type: 'quiz_question', prompt: 'Which structure is recommended for a self-introduction?',
            options: [{ id: 'a', text: 'Family background → schooling → hobbies' }, { id: 'b', text: 'Present status → past experience → future goal' }, { id: 'c', text: 'A full list of every skill on the resume' }, { id: 'd', text: 'An opening joke, then your name' }],
            correct: 'b', guidance: 'The Present → Past → Future arc keeps the intro relevant and forward-looking.' },
          { type: 'quiz_question', prompt: 'What is the ideal length for a self-introduction?',
            options: [{ id: 'a', text: '10–15 seconds' }, { id: 'b', text: '60–90 seconds' }, { id: 'c', text: '4–5 minutes' }, { id: 'd', text: 'As long as possible' }],
            correct: 'b', guidance: 'Long enough to be substantive, short enough to hold attention.' },
          { type: 'quiz_question', prompt: 'A candidate lists every course on their transcript during the intro. This is:',
            options: [{ id: 'a', text: 'Strong structure' }, { id: 'b', text: 'Reciting the resume instead of narrating it' }, { id: 'c', text: 'Good time management' }, { id: 'd', text: 'Appropriate depth' }],
            correct: 'b', guidance: 'Listing resume lines verbatim is one of the most common weak-answer patterns.' },
        ] },
      {
        key: 'resume_walkthrough', name: 'Resume Walkthrough',
        items: [
          { type: 'learn_example',
            prompt: 'How do you walk an interviewer through a resume line without just reading it?',
            guidance: 'Strong: names the project/role, states the concrete problem it solved, and gives one measurable outcome. Weak: reads the bullet point aloud with no added context or outcome.',
            mistakes: 'Reading bullets verbatim; no outcome/impact mentioned; jumping between unrelated items with no narrative thread; over-explaining minor coursework.' },
          { type: 'practice_prompt', prompt: 'Pick one resume line and explain it in 3 sentences: what it was, what you did, what happened.' },
          { type: 'practice_prompt', prompt: 'Explain your most recent internship/project as if the interviewer has never seen your resume.' },
          { type: 'quiz_question', prompt: 'What should you add beyond what\'s written on a resume bullet?',
            options: [{ id: 'a', text: 'Nothing — read it exactly as written' }, { id: 'b', text: 'Context and a concrete outcome' }, { id: 'c', text: 'A list of every tool you have ever used' }, { id: 'd', text: 'An apology for a low GPA' }],
            correct: 'b', guidance: 'The resume is a prompt, not a script — add the "why it mattered."' },
          { type: 'quiz_question', prompt: 'Which is the strongest way to end a resume walkthrough of a project?',
            options: [{ id: 'a', text: '"...and that\'s pretty much it."' }, { id: 'b', text: 'State the measurable result or what you learned' }, { id: 'c', text: 'List every technology used' }, { id: 'd', text: 'Move on without a conclusion' }],
            correct: 'b', guidance: 'Ending on outcome/result gives the interviewer something concrete to follow up on.' },
          { type: 'quiz_question', prompt: 'A student explains 6 different projects in the time meant for 1. This is a mistake in:',
            options: [{ id: 'a', text: 'Technical depth' }, { id: 'b', text: 'Pacing and focus' }, { id: 'c', text: 'Grammar' }, { id: 'd', text: 'Confidence' }],
            correct: 'b', guidance: 'Depth on one relevant project beats a shallow tour of many.' },
        ] },
      {
        key: 'star_storytelling', name: 'Project Explanation (STAR)',
        items: [
          { type: 'learn_example',
            prompt: 'What is the STAR method and when should you use it for a project story?',
            guidance: 'Situation, Task, Action, Result. Strong: brief situation, clear task, specific actions YOU took, and a measurable result. Weak: long situation setup, vague "we" language throughout with no individual contribution, no result stated.',
            mistakes: 'Spending 80% of the answer on situation/background; using "we" the whole time with no individual action; no measurable result; result is vague ("it worked well").' },
          { type: 'practice_prompt', prompt: 'Use STAR to explain your final-year/capstone project in under 2 minutes.' },
          { type: 'practice_prompt', prompt: 'Use STAR to explain a technical challenge you personally solved within a group project.' },
          { type: 'quiz_question', prompt: 'What does the "A" in STAR stand for?',
            options: [{ id: 'a', text: 'Ability' }, { id: 'b', text: 'Action' }, { id: 'c', text: 'Assessment' }, { id: 'd', text: 'Award' }],
            correct: 'b', guidance: 'Action — the specific steps YOU took.' },
          { type: 'quiz_question', prompt: 'Which STAR component is most often skipped by weak answers?',
            options: [{ id: 'a', text: 'Situation' }, { id: 'b', text: 'Task' }, { id: 'c', text: 'Result' }, { id: 'd', text: 'Introduction' }],
            correct: 'c', guidance: 'Candidates often stop after describing actions and never state the outcome.' },
          { type: 'quiz_question', prompt: 'A candidate says "we built a great app" the entire time without saying what they did. This weakens the answer because:',
            options: [{ id: 'a', text: 'It sounds too confident' }, { id: 'b', text: 'The interviewer can\'t tell the candidate\'s individual contribution' }, { id: 'c', text: 'It is too short' }, { id: 'd', text: 'It uses too much jargon' }],
            correct: 'b', guidance: 'Interviewers are assessing the individual, not the team.' },
        ] },
    ] },
  {
    moduleKey: 'technical_interview',
    topics: [
      {
        key: 'programming_fundamentals', name: 'Programming Fundamentals',
        items: [
          { type: 'learn_example',
            prompt: 'How do you explain the difference between a process and a thread?',
            guidance: 'Strong: a process has its own memory space; threads within a process share memory but run independently, with a concrete example (multiple browser tabs = processes, tabs sharing one render engine\'s workers = threads). Weak: "a thread is smaller than a process" with no example.',
            mistakes: 'Confusing process vs thread definitions; no real-world example; memorized definition with no follow-through when asked "why does this matter?"' },
          { type: 'practice_prompt', prompt: 'Explain how your project used any form of concurrency, or explain why it didn\'t need to.' },
          { type: 'quiz_question', prompt: 'Which best describes a thread?',
            options: [{ id: 'a', text: 'An independent program with its own memory space' }, { id: 'b', text: 'A unit of execution that shares memory with other threads in the same process' }, { id: 'c', text: 'A type of database index' }, { id: 'd', text: 'A network protocol' }],
            correct: 'b', guidance: 'Threads share the process\'s memory space; processes do not share memory with each other.' },
          { type: 'quiz_question', prompt: 'What is the time complexity of accessing an element in an array by index?',
            options: [{ id: 'a', text: 'O(1)' }, { id: 'b', text: 'O(n)' }, { id: 'c', text: 'O(log n)' }, { id: 'd', text: 'O(n^2)' }],
            correct: 'a', guidance: 'Array indexing is constant time — direct memory offset calculation.' },
          { type: 'quiz_question', prompt: 'What does "pass by reference" mean?',
            options: [{ id: 'a', text: 'A copy of the value is passed to the function' }, { id: 'b', text: 'The function receives access to the original variable\'s memory location' }, { id: 'c', text: 'The variable is deleted after the function call' }, { id: 'd', text: 'The value is converted to a string' }],
            correct: 'b', guidance: 'Changes inside the function affect the original variable.' },
        ] },
      {
        key: 'data_structures', name: 'Data Structures',
        items: [
          { type: 'learn_example',
            prompt: 'When would you use a hash map instead of an array?',
            guidance: 'Strong: when lookups by key need to be fast (O(1) average) rather than by position — e.g. counting word frequency. Weak: "hash maps are better than arrays" with no context.',
            mistakes: 'Claiming one structure is universally "better"; not knowing the average vs worst-case complexity difference; confusing hash map with hash set.' },
          { type: 'practice_prompt', prompt: 'Describe a data structure you used in a project and explain why it was the right choice.' },
          { type: 'quiz_question', prompt: 'What is the average time complexity of a lookup in a hash map?',
            options: [{ id: 'a', text: 'O(1)' }, { id: 'b', text: 'O(n)' }, { id: 'c', text: 'O(n log n)' }, { id: 'd', text: 'O(n^2)' }],
            correct: 'a', guidance: 'Average case O(1); worst case can degrade to O(n) with poor hashing.' },
          { type: 'quiz_question', prompt: 'Which data structure follows Last-In-First-Out (LIFO)?',
            options: [{ id: 'a', text: 'Queue' }, { id: 'b', text: 'Stack' }, { id: 'c', text: 'Linked list' }, { id: 'd', text: 'Hash map' }],
            correct: 'b', guidance: 'A stack pops the most recently pushed item first.' },
          { type: 'quiz_question', prompt: 'What is a key trade-off of a linked list vs. an array?',
            options: [{ id: 'a', text: 'Linked lists allow O(1) index access, arrays don\'t' }, { id: 'b', text: 'Linked lists allow O(1) insertion at a known node, but no O(1) index access' }, { id: 'c', text: 'Arrays cannot store duplicate values' }, { id: 'd', text: 'Linked lists use less memory per element' }],
            correct: 'b', guidance: 'Linked lists trade random access speed for flexible insertion/removal.' },
        ] },
      {
        key: 'databases', name: 'Databases',
        items: [
          { type: 'learn_example',
            prompt: 'What is database normalization and why is it useful?',
            guidance: 'Strong: organizing tables to reduce data redundancy and avoid update anomalies, with an example (splitting a customer\'s repeated address into a separate table) and the trade-off (more joins needed). Weak: definition only, no example, no trade-off.',
            mistakes: 'Memorized definition with no example; not knowing normalization has a query-performance trade-off; confusing normalization with indexing.' },
          { type: 'practice_prompt', prompt: 'Explain how your project\'s database was structured and why you designed it that way.' },
          { type: 'quiz_question', prompt: 'What is the main goal of normalization?',
            options: [{ id: 'a', text: 'Increase query speed at all costs' }, { id: 'b', text: 'Reduce data redundancy and avoid update anomalies' }, { id: 'c', text: 'Encrypt sensitive data' }, { id: 'd', text: 'Reduce the number of tables to one' }],
            correct: 'b', guidance: 'Normalization organizes data to minimize duplication and inconsistency.' },
          { type: 'quiz_question', prompt: 'What does a PRIMARY KEY guarantee?',
            options: [{ id: 'a', text: 'The column can contain duplicate values' }, { id: 'b', text: 'Each row is uniquely identifiable by that column' }, { id: 'c', text: 'The table has an index on every column' }, { id: 'd', text: 'The column must be text type' }],
            correct: 'b', guidance: 'Primary keys enforce row-level uniqueness.' },
          { type: 'quiz_question', prompt: 'What is a foreign key used for?',
            options: [{ id: 'a', text: 'Encrypting a column' }, { id: 'b', text: 'Linking a row to a row in another table' }, { id: 'c', text: 'Sorting a table alphabetically' }, { id: 'd', text: 'Renaming a table' }],
            correct: 'b', guidance: 'Foreign keys enforce referential relationships between tables.' },
        ] },
    ] },
  {
    moduleKey: 'problem_solving',
    topics: [
      {
        key: 'structured_thinking', name: 'Structured Thinking Frameworks',
        items: [
          { type: 'learn_example',
            prompt: 'What framework should you use when facing an ambiguous problem-solving question?',
            guidance: 'Strong: Clarify → Structure → Solve → Communicate. Ask a clarifying question first, break the problem into parts out loud, work through it, then summarize the answer clearly. Weak: guessing an answer immediately with no structure shown.',
            mistakes: 'Jumping to an answer without clarifying; solving silently instead of thinking out loud; no final summary.' },
          { type: 'practice_prompt', prompt: 'Apply Clarify → Structure → Solve → Communicate to: "How would you improve student attendance on campus?"' },
          { type: 'quiz_question', prompt: 'What is the first step in the recommended problem-solving framework?',
            options: [{ id: 'a', text: 'Solve immediately' }, { id: 'b', text: 'Clarify the question' }, { id: 'c', text: 'Communicate the answer' }, { id: 'd', text: 'Ask for the answer key' }],
            correct: 'b', guidance: 'Clarifying first prevents solving the wrong problem.' },
          { type: 'quiz_question', prompt: 'Why is "thinking out loud" recommended during a problem-solving round?',
            options: [{ id: 'a', text: 'It fills silence' }, { id: 'b', text: 'It lets the interviewer see your reasoning process, not just the final answer' }, { id: 'c', text: 'It is required by law' }, { id: 'd', text: 'It makes the answer longer' }],
            correct: 'b', guidance: 'Interviewers are evaluating the reasoning path, not just correctness.' },
          { type: 'quiz_question', prompt: 'A candidate gives a one-word answer with no explanation to a scenario question. This is a mistake because:',
            options: [{ id: 'a', text: 'It shows confidence' }, { id: 'b', text: 'It gives the interviewer nothing to evaluate' }, { id: 'c', text: 'It is too long' }, { id: 'd', text: 'It uses too much jargon' }],
            correct: 'b', guidance: 'The structure and reasoning matter as much as the final answer.' },
        ] },
      {
        key: 'estimation_scenarios', name: 'Estimation / Scenario Questions',
        items: [
          { type: 'learn_example',
            prompt: 'How would you approach "Estimate the number of ATMs in a city"?',
            guidance: 'Strong: states assumptions out loud (population, % using ATMs, ATMs per person), does rough math, gives a reasoned range. Weak: refuses to guess, or gives a number with zero reasoning shown.',
            mistakes: 'Saying "I don\'t know" without attempting a structured guess; not stating assumptions; overcomplicating the math instead of rounding sensibly.' },
          { type: 'practice_prompt', prompt: 'Estimate how many people use the campus library on a weekday — state your assumptions.' },
          { type: 'quiz_question', prompt: 'In an estimation question, what should you do first?',
            options: [{ id: 'a', text: 'State a random number confidently' }, { id: 'b', text: 'State your assumptions clearly' }, { id: 'c', text: 'Ask to skip the question' }, { id: 'd', text: 'Calculate to the exact decimal' }],
            correct: 'b', guidance: 'Stated assumptions let the interviewer follow and adjust your reasoning.' },
          { type: 'quiz_question', prompt: 'Why is rounding acceptable in estimation questions?',
            options: [{ id: 'a', text: 'Exact precision is the goal' }, { id: 'b', text: 'The interviewer is testing reasoning approach, not exact accuracy' }, { id: 'c', text: 'It saves time typing' }, { id: 'd', text: 'It is not acceptable' }],
            correct: 'b', guidance: 'These questions test structured reasoning, not arithmetic precision.' },
          { type: 'quiz_question', prompt: 'What should you do if you realize your assumption was wrong mid-answer?',
            options: [{ id: 'a', text: 'Ignore it and continue' }, { id: 'b', text: 'Acknowledge it and adjust your reasoning' }, { id: 'c', text: 'Restart from silence' }, { id: 'd', text: 'End the answer immediately' }],
            correct: 'b', guidance: 'Adjusting openly shows self-correction, a positive signal.' },
        ] },
      {
        key: 'trade_off_reasoning', name: 'Trade-off Reasoning',
        items: [
          { type: 'learn_example',
            prompt: 'How do you answer a question with no single "correct" solution, like choosing between two approaches?',
            guidance: 'Strong: names both options, states at least one pro/con for each, then picks one with a justified reason tied to the context given. Weak: picks one option with no comparison shown.',
            mistakes: 'Not acknowledging the trade-off exists; refusing to commit to an answer; ignoring the context given in the question.' },
          { type: 'practice_prompt', prompt: 'Would you optimize a system for speed or for cost, given limited budget? Justify your choice.' },
          { type: 'quiz_question', prompt: 'What makes a trade-off answer strong?',
            options: [{ id: 'a', text: 'Refusing to pick a side' }, { id: 'b', text: 'Acknowledging both options and justifying the final choice' }, { id: 'c', text: 'Only mentioning the option you prefer' }, { id: 'd', text: 'Giving the longest possible answer' }],
            correct: 'b', guidance: 'Interviewers want to see you weigh options, not just state a preference.' },
          { type: 'quiz_question', prompt: 'A candidate is asked to choose between speed and accuracy but just says "both are important" with no decision. This is:',
            options: [{ id: 'a', text: 'A strong, balanced answer' }, { id: 'b', text: 'An avoidance of the actual question' }, { id: 'c', text: 'The correct technical answer' }, { id: 'd', text: 'A sign of deep expertise' }],
            correct: 'b', guidance: 'Avoiding a decision is itself a weak signal — commit to a reasoned choice.' },
          { type: 'quiz_question', prompt: 'Why does context in the question matter for a trade-off answer?',
            options: [{ id: 'a', text: 'It doesn\'t matter' }, { id: 'b', text: 'The "right" trade-off depends on the specific constraints given' }, { id: 'c', text: 'Context should be ignored to keep answers generic' }, { id: 'd', text: 'It only matters for technical questions' }],
            correct: 'b', guidance: 'A good trade-off answer is tailored to the stated constraints, not generic.' },
        ] },
    ] },
  {
    moduleKey: 'behavioral_interview',
    topics: [
      {
        key: 'teamwork', name: 'Teamwork',
        items: [
          { type: 'learn_example',
            prompt: 'How do you answer "Tell me about a time you worked in a team"?',
            guidance: 'Strong: STAR-structured, names your specific role and contribution, and a concrete team outcome. Weak: generic claim like "I\'m a great team player" with no specific example.',
            mistakes: 'Generic claims with no example; describing only what the team did, not your role; picking a trivial or irrelevant example.' },
          { type: 'practice_prompt', prompt: 'Describe a time you worked in a team toward a shared deadline, using STAR.' },
          { type: 'quiz_question', prompt: 'What makes a teamwork answer weak?',
            options: [{ id: 'a', text: 'Describing a specific project' }, { id: 'b', text: 'Making a generic claim with no concrete example' }, { id: 'c', text: 'Mentioning a measurable outcome' }, { id: 'd', text: 'Naming your specific role' }],
            correct: 'b', guidance: 'Unsupported claims ("I\'m a team player") carry no evidence.' },
          { type: 'quiz_question', prompt: 'When describing a team project, what should you emphasize?',
            options: [{ id: 'a', text: 'Only what the team accomplished as a whole' }, { id: 'b', text: 'Your specific individual contribution within the team' }, { id: 'c', text: 'Only the technologies used' }, { id: 'd', text: 'How the team was formed' }],
            correct: 'b', guidance: 'The interviewer is assessing you, not the team.' },
          { type: 'quiz_question', prompt: 'Which is a stronger opening for a teamwork story?',
            options: [{ id: 'a', text: '"I am always a good team player."' }, { id: 'b', text: '"During my final-year project, our team of 4 had to..."' }, { id: 'c', text: '"Teamwork is important to me."' }, { id: 'd', text: '"I don\'t have a specific example."' }],
            correct: 'b', guidance: 'A concrete situation beats a general claim.' },
        ] },
      {
        key: 'conflict_resolution', name: 'Conflict Resolution',
        items: [
          { type: 'learn_example',
            prompt: 'How do you answer "Tell me about a time you disagreed with a teammate"?',
            guidance: 'Strong: describes the disagreement factually, explains how it was resolved through communication/compromise, and a positive outcome — without blaming the other person. Weak: blames the teammate, or claims to never have disagreements.',
            mistakes: 'Blaming the other person; claiming to never have conflicts (sounds evasive); no resolution described; airing unnecessary negative detail.' },
          { type: 'practice_prompt', prompt: 'Describe a disagreement with a teammate and how it was resolved, using STAR.' },
          { type: 'quiz_question', prompt: 'What is a red flag in a conflict-resolution answer?',
            options: [{ id: 'a', text: 'Describing a specific disagreement' }, { id: 'b', text: 'Blaming the other person entirely' }, { id: 'c', text: 'Explaining how it was resolved' }, { id: 'd', text: 'Mentioning what was learned' }],
            correct: 'b', guidance: 'Blame signals poor self-awareness and conflict management.' },
          { type: 'quiz_question', prompt: 'What should a strong conflict story end with?',
            options: [{ id: 'a', text: 'An unresolved argument' }, { id: 'b', text: 'A resolution and what was learned' }, { id: 'c', text: 'A complaint about the teammate' }, { id: 'd', text: 'No conclusion at all' }],
            correct: 'b', guidance: 'A resolution shows maturity and problem-solving ability.' },
          { type: 'quiz_question', prompt: 'Claiming "I never disagree with anyone" in an interview is typically seen as:',
            options: [{ id: 'a', text: 'A strong, confident answer' }, { id: 'b', text: 'Evasive and unrealistic' }, { id: 'c', text: 'The ideal response' }, { id: 'd', text: 'Proof of leadership' }],
            correct: 'b', guidance: 'Interviewers expect a real example — claiming none raises doubt.' },
        ] },
      {
        key: 'failure_and_learning', name: 'Failure & Learning',
        items: [
          { type: 'learn_example',
            prompt: 'How do you answer "Tell me about a time you failed"?',
            guidance: 'Strong: picks a real, meaningful failure, owns it without excessive self-blame, and clearly states what changed afterward. Weak: picks a "fake" failure ("I work too hard") or avoids taking any real responsibility.',
            mistakes: 'Choosing a humble-brag "failure"; not taking genuine responsibility; no clear lesson/change described; dwelling too long on the negative without pivoting to growth.' },
          { type: 'practice_prompt', prompt: 'Describe a real failure or setback and what you changed because of it, using STAR.' },
          { type: 'quiz_question', prompt: 'What is a common mistake when answering "tell me about a failure"?',
            options: [{ id: 'a', text: 'Choosing a real setback' }, { id: 'b', text: 'Disguising a strength as a fake failure' }, { id: 'c', text: 'Describing what was learned' }, { id: 'd', text: 'Taking ownership' }],
            correct: 'b', guidance: '"I work too hard" style answers read as evasive, not genuine.' },
          { type: 'quiz_question', prompt: 'What should follow the description of the failure itself?',
            options: [{ id: 'a', text: 'Nothing — end there' }, { id: 'b', text: 'What you learned and changed afterward' }, { id: 'c', text: 'Blaming external circumstances' }, { id: 'd', text: 'A joke to lighten the mood' }],
            correct: 'b', guidance: 'The growth/change is the actual point of the question.' },
          { type: 'quiz_question', prompt: 'Why do interviewers ask about failure at all?',
            options: [{ id: 'a', text: 'To catch candidates in a lie' }, { id: 'b', text: 'To assess self-awareness and ability to grow from setbacks' }, { id: 'c', text: 'To fill time' }, { id: 'd', text: 'It has no real purpose' }],
            correct: 'b', guidance: 'It signals maturity and a growth mindset.' },
        ] },
    ] },
  {
    moduleKey: 'hr_final_round',
    topics: [
      {
        key: 'why_this_company', name: 'Why This Company',
        items: [
          { type: 'learn_example',
            prompt: 'How do you answer "Why do you want to work here?"',
            guidance: 'Strong: references something specific and true about the company (a product, value, or recent initiative) and connects it to your own goals. Weak: generic answer that could apply to any company ("I want to grow and learn").',
            mistakes: 'Generic answer with no company-specific detail; no research done beforehand; focusing only on what the company gives you, not what you bring.' },
          { type: 'practice_prompt', prompt: 'Research a company you\'re interested in and write a specific, non-generic "why this company" answer.' },
          { type: 'quiz_question', prompt: 'What makes a "why this company" answer weak?',
            options: [{ id: 'a', text: 'Mentioning a specific product or initiative' }, { id: 'b', text: 'Being generic enough to apply to any company' }, { id: 'c', text: 'Connecting the company to your goals' }, { id: 'd', text: 'Showing you did research' }],
            correct: 'b', guidance: 'A generic answer signals no real research or interest.' },
          { type: 'quiz_question', prompt: 'What should you do before answering "why this company"?',
            options: [{ id: 'a', text: 'Nothing — improvise' }, { id: 'b', text: 'Research the company\'s products, values, or recent news' }, { id: 'c', text: 'Only look at the salary' }, { id: 'd', text: 'Ask a friend what to say' }],
            correct: 'b', guidance: 'Specific, researched detail is what separates strong answers.' },
          { type: 'quiz_question', prompt: 'Which is a stronger reason to give?',
            options: [{ id: 'a', text: '"I need a job."' }, { id: 'b', text: '"Your recent work on X aligns with what I want to build a career in."' }, { id: 'c', text: '"This company is famous."' }, { id: 'd', text: '"My friend works here."' }],
            correct: 'b', guidance: 'Specific and aligned reasons outperform generic or self-serving ones.' },
        ] },
      {
        key: 'strengths_weaknesses', name: 'Strengths & Weaknesses',
        items: [
          { type: 'learn_example',
            prompt: 'How do you answer "What is your biggest weakness?"',
            guidance: 'Strong: names a real, relevant weakness and describes a genuine action taken to improve it. Weak: a disguised strength ("I\'m a perfectionist") or a weakness irrelevant to the role.',
            mistakes: 'Disguising a strength as a weakness; naming something core to the job (e.g. "I\'m bad at coding" for an SDE role); no improvement action mentioned.' },
          { type: 'practice_prompt', prompt: 'Write an honest weakness answer that includes a specific action you\'ve taken to improve.' },
          { type: 'quiz_question', prompt: 'What is a classic weak-answer pattern for "biggest weakness"?',
            options: [{ id: 'a', text: 'Naming a real, relevant weakness' }, { id: 'b', text: 'Disguising a strength as a weakness (e.g. "I work too hard")' }, { id: 'c', text: 'Describing an improvement action' }, { id: 'd', text: 'Being specific' }],
            correct: 'b', guidance: 'Interviewers see through disguised-strength answers quickly.' },
          { type: 'quiz_question', prompt: 'What should always follow a stated weakness?',
            options: [{ id: 'a', text: 'Nothing' }, { id: 'b', text: 'What you\'re doing to improve it' }, { id: 'c', text: 'A second, unrelated weakness' }, { id: 'd', text: 'A joke' }],
            correct: 'b', guidance: 'The improvement action is what makes the answer credible.' },
          { type: 'quiz_question', prompt: 'Naming a weakness that is core to the job you\'re applying for is risky because:',
            options: [{ id: 'a', text: 'It shows honesty above all' }, { id: 'b', text: 'It directly undermines your candidacy for that specific role' }, { id: 'c', text: 'It is always the best answer' }, { id: 'd', text: 'Interviewers expect it' }],
            correct: 'b', guidance: 'Pick something real but not disqualifying for the specific role.' },
        ] },
      {
        key: 'career_goals', name: 'Career Goals',
        items: [
          { type: 'learn_example',
            prompt: 'How do you answer "Where do you see yourself in 5 years?"',
            guidance: 'Strong: a realistic, specific growth path connected to the role applied for. Weak: an unrelated goal ("I want to start my own company in a different field") or an overly vague answer ("I just want to be successful").',
            mistakes: 'Vague, non-committal answers; a goal unrelated to the role/industry; sounding like the job is just a stepping stone with no real interest.' },
          { type: 'practice_prompt', prompt: 'Write a 5-year career goal answer connected to the specific role you\'re targeting.' },
          { type: 'quiz_question', prompt: 'What makes a career-goals answer strong?',
            options: [{ id: 'a', text: 'Being vague to keep options open' }, { id: 'b', text: 'A realistic, specific path connected to the role' }, { id: 'c', text: 'Mentioning an unrelated industry' }, { id: 'd', text: 'Avoiding any commitment' }],
            correct: 'b', guidance: 'Specificity and relevance signal genuine interest in the role.' },
          { type: 'quiz_question', prompt: 'Why is "I just want to be successful" a weak answer?',
            options: [{ id: 'a', text: 'It is too specific' }, { id: 'b', text: 'It is too vague to show any real direction' }, { id: 'c', text: 'It is too long' }, { id: 'd', text: 'It is inappropriate' }],
            correct: 'b', guidance: 'Vague answers give the interviewer nothing to evaluate.' },
          { type: 'quiz_question', prompt: 'What should a career-goals answer connect to?',
            options: [{ id: 'a', text: 'A completely different industry' }, { id: 'b', text: 'The role and company you\'re interviewing for' }, { id: 'c', text: 'Nothing in particular' }, { id: 'd', text: 'Your personal hobbies only' }],
            correct: 'b', guidance: 'Relevance to the actual opportunity makes the answer credible.' },
        ] },
    ] },
];

async function ensureCampusContentSeeded() {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM campus_topics`);
  if (rows[0].n > 0) {
    console.log('[campus-seed] content already present, skipping.');
    return;
  }
  console.log('[campus-seed] seeding Campus Ready V1 PILOT content (90 items -- initial pilot set, not the full 270-335 item curriculum from the content spec).');
  for (const mod of SEED) {
    const modRow = (await pool.query(`SELECT id FROM campus_modules WHERE key = $1`, [mod.moduleKey])).rows[0];
    if (!modRow) { console.warn(`[campus-seed] module not found: ${mod.moduleKey} — did the migration run?`); continue; }
    let topicSeq = 0;
    for (const topic of mod.topics) {
      topicSeq += 1;
      const topicRow = (await pool.query(
        `INSERT INTO campus_topics (module_id, key, name, sequence) VALUES ($1,$2,$3,$4) RETURNING id`,
        [modRow.id, topic.key, topic.name, topicSeq]
      )).rows[0];
      let itemSeq = 0;
      for (const item of topic.items) {
        itemSeq += 1;
        await pool.query(
          `INSERT INTO campus_content_items
             (topic_id, item_type, prompt_text, answer_guidance, options, correct_option_id, common_mistake_notes, sequence)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            topicRow.id, item.type, item.prompt,
            item.guidance || null,
            item.options ? JSON.stringify(item.options) : null,
            item.correct || null,
            item.mistakes || null,
            itemSeq,
          ]
        );
      }
    }
  }
  console.log('[campus-seed] done.');
}

module.exports = { ensureCampusContentSeeded };
