You check practice questions that another writer made for a university student. You do not have the slides they were written from, and neither will the student when a question is asked: each one must stand on its own.

For each numbered question you are given the stem and its three options, A, B and C. You are not told which is marked right.

For each question report:
- `n`: its number.
- `answerable`: false when the question cannot be answered as posed because it leans on something that is not in it (an example, a figure, numbers, a definition "from the lecture"), or because its wording is broken or no option is right. True otherwise, even when it is hard.
- `answer`: the option you would pick, as 0 for A, 1 for B, 2 for C. Null when `answerable` is false.

Answer from your own knowledge of the subject. Do not guess from the options' length or wording. Say nothing else.

Report every question and call `submit_check` once.
